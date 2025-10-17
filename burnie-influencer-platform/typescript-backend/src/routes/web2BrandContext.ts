import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { BrandContext } from '../models/BrandContext';
import { Account } from '../models/Account';
import { AccountClient } from '../models/AccountClient';
import { logger } from '../config/logger';
import { IsNull } from 'typeorm';

const router = Router();

/**
 * @route   GET /api/web2-brand-context/account/:accountId
 * @desc    Get brand context for an account
 * @access  Private
 */
router.get('/account/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;

    const brandContextRepo = AppDataSource.getRepository(BrandContext);
    const brandContext = await brandContextRepo.findOne({
      where: { account_id: accountId as string, account_client_id: IsNull() }
    });

    if (!brandContext) {
      res.status(404).json({
        success: false,
        error: 'Brand context not found'
      });
      return;
    }

    res.json({
      success: true,
      data: brandContext
    });
  } catch (error) {
    logger.error('Error fetching brand context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch brand context'
    });
  }
});

/**
 * @route   GET /api/web2-brand-context/client/:clientId
 * @desc    Get brand context for a client
 * @access  Private
 */
router.get('/client/:clientId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params;

    const brandContextRepo = AppDataSource.getRepository(BrandContext);
    const brandContext = await brandContextRepo.findOne({
      where: { account_client_id: clientId as string }
    });

    if (!brandContext) {
      res.status(404).json({
        success: false,
        error: 'Brand context not found'
      });
      return;
    }

    res.json({
      success: true,
      data: brandContext
    });
  } catch (error) {
    logger.error('Error fetching client brand context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch brand context'
    });
  }
});

/**
 * @route   POST /api/web2-brand-context/account/:accountId
 * @desc    Create or update brand context for an account
 * @access  Private
 */
router.post('/account/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const {
      brand_name,
      brand_tagline,
      brand_description,
      brand_values,
      target_audience,
      tone_of_voice,
      color_palette,
      typography_preferences,
      logo_url,
      product_images,
      brand_aesthetics,
      industry_specific_context,
      content_preferences
    } = req.body;

    // Verify account exists
    const accountRepo = AppDataSource.getRepository(Account);
    const account = await accountRepo.findOne({ where: { id: accountId as string } });

    if (!account) {
      res.status(404).json({
        success: false,
        error: 'Account not found'
      });
      return;
    }

    const brandContextRepo = AppDataSource.getRepository(BrandContext);
    
    // Check if brand context already exists
    let brandContext = await brandContextRepo.findOne({
      where: { account_id: accountId as string, account_client_id: IsNull() }
    });

    if (brandContext) {
      // Update existing
      if (brand_name) brandContext.brand_name = brand_name;
      if (brand_tagline) brandContext.brand_tagline = brand_tagline;
      if (brand_description) brandContext.brand_description = brand_description;
      if (brand_values) brandContext.brand_values = brand_values;
      if (target_audience) brandContext.target_audience = target_audience;
      if (tone_of_voice) brandContext.tone_of_voice = tone_of_voice;
      if (color_palette) brandContext.color_palette = color_palette;
      if (typography_preferences) brandContext.typography_preferences = typography_preferences;
      if (logo_url) brandContext.logo_url = logo_url;
      if (product_images) brandContext.product_images = product_images;
      if (brand_aesthetics) brandContext.brand_aesthetics = brand_aesthetics;
      if (industry_specific_context) brandContext.industry_specific_context = industry_specific_context;
      if (content_preferences) brandContext.content_preferences = content_preferences;
    } else {
      // Create new
      brandContext = brandContextRepo.create({ account_id: accountId as string,
        brand_name,
        brand_tagline,
        brand_description,
        brand_values,
        target_audience,
        tone_of_voice,
        color_palette,
        typography_preferences,
        logo_url,
        product_images,
        brand_aesthetics,
        industry_specific_context,
        content_preferences
      });
    }

    await brandContextRepo.save(brandContext);

    res.json({
      success: true,
      data: brandContext
    });
  } catch (error) {
    logger.error('Error saving brand context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save brand context'
    });
  }
});

/**
 * @route   POST /api/web2-brand-context/client/:clientId
 * @desc    Create or update brand context for a client
 * @access  Private
 */
router.post('/client/:clientId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId } = req.params;
    const {
      brand_name,
      brand_tagline,
      brand_description,
      brand_values,
      target_audience,
      tone_of_voice,
      color_palette,
      typography_preferences,
      logo_url,
      product_images,
      brand_aesthetics,
      industry_specific_context,
      content_preferences
    } = req.body;

    // Verify client exists
    const accountClientRepo = AppDataSource.getRepository(AccountClient);
    const client = await accountClientRepo.findOne({ where: { id: clientId as string } });

    if (!client) {
      res.status(404).json({
        success: false,
        error: 'Client not found'
      });
      return;
    }

    const brandContextRepo = AppDataSource.getRepository(BrandContext);
    
    // Check if brand context already exists
    let brandContext = await brandContextRepo.findOne({
      where: { account_client_id: clientId as string }
    });

    if (brandContext) {
      // Update existing
      if (brand_name) brandContext.brand_name = brand_name;
      if (brand_tagline) brandContext.brand_tagline = brand_tagline;
      if (brand_description) brandContext.brand_description = brand_description;
      if (brand_values) brandContext.brand_values = brand_values;
      if (target_audience) brandContext.target_audience = target_audience;
      if (tone_of_voice) brandContext.tone_of_voice = tone_of_voice;
      if (color_palette) brandContext.color_palette = color_palette;
      if (typography_preferences) brandContext.typography_preferences = typography_preferences;
      if (logo_url) brandContext.logo_url = logo_url;
      if (product_images) brandContext.product_images = product_images;
      if (brand_aesthetics) brandContext.brand_aesthetics = brand_aesthetics;
      if (industry_specific_context) brandContext.industry_specific_context = industry_specific_context;
      if (content_preferences) brandContext.content_preferences = content_preferences;
    } else {
      // Create new
      brandContext = brandContextRepo.create({
        account_id: client.account_id,
        account_client_id: clientId as string,
        brand_name,
        brand_tagline,
        brand_description,
        brand_values,
        target_audience,
        tone_of_voice,
        color_palette,
        typography_preferences,
        logo_url,
        product_images,
        brand_aesthetics,
        industry_specific_context,
        content_preferences
      });
    }

    await brandContextRepo.save(brandContext);

    res.json({
      success: true,
      data: brandContext
    });
  } catch (error) {
    logger.error('Error saving client brand context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save brand context'
    });
  }
});

/**
 * @route   DELETE /api/web2-brand-context/:brandContextId
 * @desc    Delete brand context
 * @access  Private
 */
router.delete('/:brandContextId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { brandContextId } = req.params;

    const brandContextRepo = AppDataSource.getRepository(BrandContext);
    const brandContext = await brandContextRepo.findOne({
      where: { id: brandContextId as string }
    });

    if (!brandContext) {
      res.status(404).json({
        success: false,
        error: 'Brand context not found'
      });
      return;
    }

    await brandContextRepo.remove(brandContext);

    res.json({
      success: true,
      message: 'Brand context deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting brand context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete brand context'
    });
  }
});

export default router;

