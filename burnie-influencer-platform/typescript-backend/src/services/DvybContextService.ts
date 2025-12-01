import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { DvybContext } from '../models/DvybContext';

export class DvybContextService {
  /**
   * Get context for an account
   */
  static async getContext(accountId: number): Promise<DvybContext | null> {
    try {
      const contextRepo = AppDataSource.getRepository(DvybContext);
      const context = await contextRepo.findOne({ where: { accountId } });
      
      logger.debug(`📖 Retrieved DVYB context for account ${accountId}`);
      return context;
    } catch (error) {
      logger.error(`❌ Failed to get DVYB context for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Create or update context for an account
   */
  static async upsertContext(accountId: number, contextData: Partial<DvybContext>): Promise<DvybContext> {
    try {
      const contextRepo = AppDataSource.getRepository(DvybContext);
      let context = await contextRepo.findOne({ where: { accountId } });

      logger.info(`📝 Upserting context for account ${accountId}. contextData:`, JSON.stringify(contextData, null, 2));

      if (context) {
        // Update existing context
        Object.assign(context, contextData);
        
        logger.info(`💾 About to save context. brandStyles:`, context.brandStyles);
        logger.info(`💾 About to save context. brandVoices:`, context.brandVoices);
        
        context = await contextRepo.save(context);
        
        logger.info(`✅ Updated DVYB context for account ${accountId}. Saved brandStyles:`, context.brandStyles);
        logger.info(`✅ Updated DVYB context for account ${accountId}. Saved brandVoices:`, context.brandVoices);
      } else {
        // Create new context
        context = contextRepo.create({
          accountId,
          ...contextData,
        });
        
        try {
          context = await contextRepo.save(context);
          logger.info(`✅ Created DVYB context for account ${accountId}`);
        } catch (saveError: any) {
          // Handle unique constraint violation (race condition)
          if (saveError.code === '23505' || saveError.message?.includes('duplicate key')) {
            logger.warn(`⚠️ Race condition detected for account ${accountId}, fetching existing record`);
            
            // Another request created the record, fetch and update it
            context = await contextRepo.findOne({ where: { accountId } });
            if (context) {
              Object.assign(context, contextData);
              context = await contextRepo.save(context);
              logger.info(`✅ Updated DVYB context after race condition for account ${accountId}`);
            } else {
              throw new Error('Failed to fetch context after unique constraint violation');
            }
          } else {
            throw saveError;
          }
        }
      }

      return context;
    } catch (error) {
      logger.error(`❌ Failed to upsert DVYB context for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Build context payload for AI generation
   */
  static buildAIContextPayload(context: DvybContext): any {
    return {
      accountName: context.accountName,
      accountType: context.accountType,
      industry: context.industry,
      website: context.website,
      targetAudience: context.targetAudience,
      brandVoice: context.brandVoice,
      contentPillars: context.contentPillars,
      keywords: context.keywords,
      competitors: context.competitors,
      goals: context.goals,
      brandValues: context.brandValues,
      colorPalette: context.colorPalette,
      typography: context.typography,
      contentGuidelines: context.contentGuidelines,
      contentText: context.contentText,
      platformHandles: context.platformHandles,
      documentsText: context.documentsText,
      links: context.linksJson,
      // Web3 specific
      chain: context.chain,
      tokenSymbol: context.tokenSymbol,
    };
  }
}

