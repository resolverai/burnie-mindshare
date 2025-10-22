import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { ContextManagement } from '../models/ContextManagement';
import { BrandContext } from '../models/BrandContext';
import { Account } from '../models/Account';
import { s3Service } from '../services/S3Service';
import { extractTextFromFile, supportsTextExtraction, appendToContext } from '../utils/textExtractor';
import { logger } from '../config/logger';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size
  }
});

/**
 * GET /api/web2-context/:accountId
 * Get context management data for an account (pre-fill from brand_context if exists)
 */
router.get('/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    
    if (!accountId) {
      res.status(400).json({ success: false, error: 'Account ID is required' });
      return;
    }

    const accountIdNum = parseInt(accountId, 10);

    const contextRepo = AppDataSource.getRepository(ContextManagement);
    const brandContextRepo = AppDataSource.getRepository(BrandContext);

    // Try to fetch existing context management data
    let contextData = await contextRepo.findOne({
      where: { account_id: accountIdNum },
      order: { created_at: 'DESC' }
    });

    // If no context data exists, pre-fill from brand_context
    if (!contextData) {
      const brandContext = await brandContextRepo.findOne({
        where: { account_id: accountIdNum },
        order: { created_at: 'DESC' }
      });

      if (brandContext) {
        // Pre-fill data from brand_context
        contextData = {
          account_id: accountIdNum,
          brand_logo_url: brandContext.logo_url,
          brand_colors: {
            primary: brandContext.color_palette?.primary,
            secondary: brandContext.color_palette?.secondary,
            additional: brandContext.color_palette?.accent ? [brandContext.color_palette.accent] : []
          },
          brand_voice: brandContext.tone_of_voice?.join(', '),
          brand_story: brandContext.brand_description,
          target_audience: brandContext.target_audience,
        } as any;
      }
    }

    // Generate presigned URLs for all file references
    if (contextData) {
      const fileFields = [
        'brand_logo_url',
        'brand_guidelines_pdf_url'
      ];

      for (const field of fileFields) {
        const url = (contextData as any)[field];
        if (url) {
          try {
            const s3Key = s3Service.extractS3Key(url);
            const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
            (contextData as any)[field + '_presigned'] = presignedUrl;
          } catch (error) {
            logger.warn(`Failed to generate presigned URL for ${field}: ${error}`);
          }
        }
      }

      // Generate presigned URLs for arrays of files
      const arrayFields = [
        'brand_assets_files',
        'product_photos',
        'inspiration_images',
        'past_content_images',
        'generic_visuals'
      ];

      for (const field of arrayFields) {
        const files = (contextData as any)[field];
        if (files && Array.isArray(files)) {
          for (const file of files) {
            try {
              const s3Key = s3Service.extractS3Key(file.s3_url);
              const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
              file.presigned_url = presignedUrl;
            } catch (error) {
              logger.warn(`Failed to generate presigned URL for file in ${field}: ${error}`);
            }
          }
        }
      }
    }

    res.json({
      success: true,
      data: contextData || null
    });
  } catch (error) {
    logger.error('Error fetching context management data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch context management data'
    });
  }
});

/**
 * POST /api/web2-context/:accountId/upload-file
 * Upload a file to S3 for context management
 */
router.post('/:accountId/upload-file', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { tab, clientId } = req.body;
    
    if (!accountId || !tab) {
      res.status(400).json({ success: false, error: 'Account ID and tab are required' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file provided' });
      return;
    }

    const accountIdNum = parseInt(accountId, 10);
    const clientIdNum = clientId ? parseInt(clientId, 10) : undefined;

    // Upload to S3
    const { s3Url, s3Key } = await s3Service.uploadContextFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      accountIdNum,
      tab,
      clientIdNum
    );

    // Extract text if supported
    let extractedText = '';
    if (supportsTextExtraction(req.file.originalname)) {
      extractedText = await extractTextFromFile(req.file.buffer, req.file.originalname);
      logger.info(`Extracted ${extractedText.length} characters from ${req.file.originalname}`);
    }

    // Generate presigned URL
    const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);

    res.json({
      success: true,
      data: {
        filename: req.file.originalname,
        s3_url: s3Url,
        s3_key: s3Key,
        presigned_url: presignedUrl,
        file_type: req.file.mimetype,
        uploaded_at: new Date().toISOString(),
        extracted_text: extractedText
      }
    });
  } catch (error) {
    logger.error('Error uploading context file:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload file'
    });
  }
});

/**
 * PUT /api/web2-context/:accountId
 * Save/update context management data
 */
router.put('/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const contextData = req.body;
    
    if (!accountId) {
      res.status(400).json({ success: false, error: 'Account ID is required' });
      return;
    }

    const accountIdNum = parseInt(accountId, 10);

    const contextRepo = AppDataSource.getRepository(ContextManagement);
    const brandContextRepo = AppDataSource.getRepository(BrandContext);

    // Check if context exists
    let existingContext = await contextRepo.findOne({
      where: { account_id: accountIdNum }
    });

    // Process extra_context if new files were uploaded
    let updatedExtraContext = existingContext?.extra_context || '';
    if (contextData.new_extracted_texts && Array.isArray(contextData.new_extracted_texts)) {
      for (const text of contextData.new_extracted_texts) {
        updatedExtraContext = appendToContext(updatedExtraContext, text);
      }
    }

    // Remove new_extracted_texts from contextData as it's not a database column
    const { new_extracted_texts, ...cleanContextData } = contextData;

    const dataToSave = {
      ...cleanContextData,
      account_id: accountIdNum,
      extra_context: updatedExtraContext,
      updated_at: new Date()
    };

    let savedContext: ContextManagement;
    
    if (existingContext) {
      // Update existing
      await contextRepo.update({ id: existingContext.id }, dataToSave);
      const updated = await contextRepo.findOne({ where: { id: existingContext.id } });
      savedContext = updated!;
    } else {
      // Create new
      dataToSave.uuid = uuidv4();
      dataToSave.created_at = new Date();
      const newContext = contextRepo.create(dataToSave);
      const result = await contextRepo.save(newContext);
      savedContext = (Array.isArray(result) ? result[0] : result) as ContextManagement;
    }

    // Also update brand_context table with relevant fields
    const brandContext = await brandContextRepo.findOne({
      where: { account_id: accountIdNum }
    });

    if (brandContext) {
      // Update brand context
      const brandUpdateData: any = {};
      
      if (contextData.brand_logo_url) {
        brandUpdateData.logo_url = contextData.brand_logo_url;
      }
      
      if (contextData.brand_colors) {
        brandUpdateData.color_palette = {
          primary: contextData.brand_colors.primary,
          secondary: contextData.brand_colors.secondary,
          accent: contextData.brand_colors.additional?.[0]
        };
      }
      
      if (contextData.brand_voice) {
        brandUpdateData.tone_of_voice = contextData.brand_voice.split(',').map((v: string) => v.trim());
      }
      
      if (contextData.brand_story) {
        brandUpdateData.brand_description = contextData.brand_story;
      }
      
      if (contextData.target_audience) {
        brandUpdateData.target_audience = contextData.target_audience;
      }

      if (Object.keys(brandUpdateData).length > 0) {
        await brandContextRepo.update({ id: brandContext.id }, brandUpdateData);
      }
    }

    // Generate presigned URLs for the response
    const responseData: any = { ...savedContext };
    
    // Generate presigned URLs for single file fields
    if (savedContext.brand_logo_url) {
      try {
        const s3Key = s3Service.extractS3Key(savedContext.brand_logo_url);
        responseData.brand_logo_url_presigned = await s3Service.generatePresignedUrl(s3Key, 3600);
      } catch (error) {
        logger.warn('Failed to generate presigned URL for brand logo');
      }
    }
    
    if (savedContext.brand_guidelines_pdf_url) {
      try {
        const s3Key = s3Service.extractS3Key(savedContext.brand_guidelines_pdf_url);
        responseData.brand_guidelines_pdf_url_presigned = await s3Service.generatePresignedUrl(s3Key, 3600);
      } catch (error) {
        logger.warn('Failed to generate presigned URL for brand guidelines');
      }
    }
    
    // Generate presigned URLs for arrays of files
    const arrayFields = [
      'brand_assets_files',
      'product_photos',
      'inspiration_images',
      'past_content_images',
      'generic_visuals'
    ];
    
    for (const field of arrayFields) {
      const files = (savedContext as any)[field];
      if (files && Array.isArray(files)) {
        responseData[field] = await Promise.all(
          files.map(async (file: any) => {
            try {
              const s3Key = s3Service.extractS3Key(file.s3_url);
              const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
              return { ...file, presigned_url: presignedUrl };
            } catch (error) {
              logger.warn(`Failed to generate presigned URL for file in ${field}`);
              return file;
            }
          })
        );
      }
    }

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    logger.error('Error saving context management data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save context management data'
    });
  }
});

/**
 * GET /api/web2-context/:accountId/files/:tab
 * List all files in a specific tab
 */
router.get('/:accountId/files/:tab', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId, tab } = req.params;
    const { clientId } = req.query;
    
    if (!accountId || !tab) {
      res.status(400).json({ success: false, error: 'Account ID and tab are required' });
      return;
    }

    const accountIdNum = parseInt(accountId, 10);
    const clientIdNum = clientId ? parseInt(clientId as string, 10) : undefined;

    const s3Keys = await s3Service.listContextFiles(
      accountIdNum,
      tab as any,
      clientIdNum
    );

    // Generate presigned URLs for all files
    const files = await Promise.all(
      s3Keys.map(async (s3Key) => {
        try {
          const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
          const filename = s3Key.split('/').pop() || s3Key;
          
          return {
            filename: filename.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_/, ''), // Remove timestamp prefix
            s3_key: s3Key,
            presigned_url: presignedUrl
          };
        } catch (error) {
          logger.warn(`Failed to generate presigned URL for ${s3Key}: ${error}`);
          return null;
        }
      })
    );

    res.json({
      success: true,
      data: files.filter(f => f !== null)
    });
  } catch (error) {
    logger.error('Error listing context files:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list files'
    });
  }
});

/**
 * DELETE /api/web2-context/:accountId/files
 * Delete a file from S3 and context management
 */
router.delete('/:accountId/files', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { s3Key, field } = req.body;
    
    if (!accountId || !s3Key) {
      res.status(400).json({ success: false, error: 'Account ID and s3Key are required' });
      return;
    }

    const accountIdNum = parseInt(accountId, 10);

    // Delete from S3
    await s3Service.deleteFile(s3Key);

    // Update database to remove file reference
    if (field) {
      const contextRepo = AppDataSource.getRepository(ContextManagement);
      const context = await contextRepo.findOne({ where: { account_id: accountIdNum } });
      
      if (context) {
        const fieldValue = (context as any)[field];
        
        if (Array.isArray(fieldValue)) {
          // Remove from array
          (context as any)[field] = fieldValue.filter((f: any) => 
            f.s3_url !== s3Key && !f.s3_url.includes(s3Key)
          );
          await contextRepo.save(context);
        } else if (typeof fieldValue === 'string' && fieldValue === s3Key) {
          // Clear single value
          (context as any)[field] = null;
          await contextRepo.save(context);
        }
      }
    }

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting context file:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete file'
    });
  }
});

export default router;

