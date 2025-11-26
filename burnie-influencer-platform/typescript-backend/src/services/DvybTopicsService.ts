import { AppDataSource } from '../config/database';
import { DvybBrandTopics, TopicWithExample } from '../models/DvybBrandTopics';
import { DvybContext } from '../models/DvybContext';
import { logger } from '../config/logger';

export class DvybTopicsService {
  /**
   * Generate brand topics by calling Python AI backend
   */
  static async generateBrandTopics(accountId: number): Promise<TopicWithExample[]> {
    try {
      logger.info(`🎯 Generating brand topics for account ${accountId}`);

      // Get context for the account
      const contextRepo = AppDataSource.getRepository(DvybContext);
      const context = await contextRepo.findOne({ where: { accountId } });

      if (!context) {
        throw new Error('Context not found for account');
      }

      // Call Python AI backend
      const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(`${pythonBackendUrl}/api/dvyb/topics/generate-topics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_id: accountId,
          business_overview: context.businessOverview,
          customer_demographics: context.customerDemographics,
          popular_products: context.popularProducts,
          why_customers_choose: context.whyCustomersChoose,
          brand_story: context.brandStory,
          media_channels: context.mediaChannels,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Python backend error: ${errorText}`);
        throw new Error('Topic generation failed');
      }

      const result: any = await response.json();

      if (!result.success || !result.data?.topics) {
        throw new Error(result.error || 'Topic generation failed');
      }

      const topics: TopicWithExample[] = result.data.topics;
      logger.info(`✅ Generated ${topics.length} topics for account ${accountId}`);

      // Save topics to database
      await this.saveGeneratedTopics(accountId, topics);

      return topics;
    } catch (error: any) {
      logger.error(`❌ Topic generation error for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Save generated topics to database
   */
  static async saveGeneratedTopics(accountId: number, topics: TopicWithExample[]): Promise<DvybBrandTopics> {
    try {
      const topicsRepo = AppDataSource.getRepository(DvybBrandTopics);

      // Check if topics already exist for this account
      let brandTopics = await topicsRepo.findOne({ where: { accountId } });

      if (brandTopics) {
        // Update existing topics
        brandTopics.generatedTopics = topics;
        brandTopics = await topicsRepo.save(brandTopics);
        logger.info(`✅ Updated topics for account ${accountId}`);
      } else {
        // Create new topics record
        brandTopics = topicsRepo.create({
          accountId,
          generatedTopics: topics,
          usedTopics: [],
        });
        brandTopics = await topicsRepo.save(brandTopics);
        logger.info(`✅ Created new topics for account ${accountId}`);
      }

      return brandTopics;
    } catch (error: any) {
      logger.error(`❌ Save topics error for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Get brand topics for an account
   */
  static async getBrandTopics(accountId: number): Promise<DvybBrandTopics | null> {
    try {
      const topicsRepo = AppDataSource.getRepository(DvybBrandTopics);
      const brandTopics = await topicsRepo.findOne({ where: { accountId } });
      return brandTopics;
    } catch (error: any) {
      logger.error(`❌ Get topics error for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Get unused topics for an account
   */
  static async getUnusedTopics(accountId: number): Promise<TopicWithExample[]> {
    try {
      const brandTopics = await this.getBrandTopics(accountId);
      if (!brandTopics) {
        return [];
      }

      const usedSet = new Set(brandTopics.usedTopics || []);
      const unusedTopics = brandTopics.generatedTopics.filter(topicObj => !usedSet.has(topicObj.topic));

      return unusedTopics;
    } catch (error: any) {
      logger.error(`❌ Get unused topics error for account ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Mark topics as used
   */
  static async markTopicsAsUsed(accountId: number, topics: string[]): Promise<void> {
    try {
      const topicsRepo = AppDataSource.getRepository(DvybBrandTopics);
      const brandTopics = await topicsRepo.findOne({ where: { accountId } });

      if (!brandTopics) {
        throw new Error('Brand topics not found');
      }

      const usedSet = new Set([...(brandTopics.usedTopics || []), ...topics]);
      brandTopics.usedTopics = Array.from(usedSet);

      await topicsRepo.save(brandTopics);
      logger.info(`✅ Marked ${topics.length} topics as used for account ${accountId}`);
    } catch (error: any) {
      logger.error(`❌ Mark topics as used error for account ${accountId}:`, error);
      throw error;
    }
  }
}

