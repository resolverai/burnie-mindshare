import * as cron from 'node-cron';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybAccountPlan } from '../models/DvybAccountPlan';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
import { Not, IsNull } from 'typeorm';
import { queueAutoGeneration, getAutoGenerationQueueStatus } from './DvybAutoGenerationQueueService';
import { logger } from '../config/logger';

/**
 * DVYB Auto-Generation Cron Service
 * 
 * Runs daily at 4:00 AM on weekdays (Mon-Fri)
 * to queue auto-generation jobs for eligible accounts.
 * Jobs are distributed throughout the day (4 AM - 11:59 PM).
 * 
 * Eligibility criteria:
 * 1. Account has autoGenerationEnabled = true
 * 2. Account has a paid plan (not free trial)
 * 3. Account is active
 * 4. Account has not already generated today
 */
export class DvybAutoGenerationCronService {
  private cronTask: cron.ScheduledTask | null = null;
  
  // Run at 4:00 AM every weekday (Mon-Fri) - PRODUCTION
  // Cron format: minute hour dayOfMonth month dayOfWeek
  private readonly schedule = '0 4 * * 1-5'; // 4:00 AM, Monday through Friday

  /**
   * Start the cron service
   */
  start(): void {
    if (this.cronTask) {
      logger.warn('⚠️ DVYB Auto-generation cron service already running');
      return;
    }

    logger.info('🤖 Starting DVYB Auto-Generation Cron Service...');
    logger.info(`⏰ Schedule: ${this.schedule} (4:00 AM on weekdays, jobs distributed 4 AM - 11:59 PM)`);

    this.cronTask = cron.schedule(this.schedule, async () => {
      try {
        logger.info('⏰ DVYB Auto-generation cron triggered');
        await this.scheduleAutoGenerations();
      } catch (error: any) {
        logger.error(`❌ Error in auto-generation cron cycle: ${error.message}`);
      }
    });

    logger.info('✅ DVYB Auto-Generation Cron Service started');
  }

  /**
   * Stop the cron service
   */
  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
      logger.info('⏹️ DVYB Auto-Generation Cron Service stopped');
    }
  }

  /**
   * Get the current status of the cron service
   */
  getStatus(): { running: boolean; schedule: string } {
    return {
      running: this.cronTask !== null,
      schedule: this.schedule
    };
  }

  /**
   * Main method to schedule auto-generations for all eligible accounts
   * Distributes jobs throughout the day (4 AM - 11:59 PM)
   */
  async scheduleAutoGenerations(): Promise<void> {
    logger.info('📋 Checking for eligible accounts for auto-generation...');

    try {
      const accountRepo = AppDataSource.getRepository(DvybAccount);
      const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
      const planRepo = AppDataSource.getRepository(DvybPricingPlan);

      // Get today's date (start of day)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find all accounts with auto-generation enabled and active
      const enabledAccounts = await accountRepo.find({
        where: {
          autoGenerationEnabled: true,
          isActive: true,
        },
      });

      logger.info(`📊 Found ${enabledAccounts.length} accounts with auto-generation enabled`);

      // Filter to only accounts that haven't generated today
      const eligibleAccounts: DvybAccount[] = [];

      for (const account of enabledAccounts) {
        // Check if already generated today
        if (account.lastAutoGenerationDate) {
          const lastGenDate = new Date(account.lastAutoGenerationDate);
          lastGenDate.setHours(0, 0, 0, 0);
          
          if (lastGenDate.getTime() >= today.getTime()) {
            logger.info(`⏭️ Account ${account.id} already generated today, skipping`);
            continue;
          }
        }

        // Check if account has a paid plan (not free trial)
        const accountPlan = await accountPlanRepo.findOne({
          where: { accountId: account.id, status: 'active' },
          order: { createdAt: 'DESC' },
        });

        if (!accountPlan) {
          logger.info(`⏭️ Account ${account.id} has no active plan, skipping`);
          continue;
        }

        const plan = await planRepo.findOne({ where: { id: accountPlan.planId } });
        if (!plan) {
          logger.info(`⏭️ Account ${account.id}'s plan not found, skipping`);
          continue;
        }

        // Skip free trial accounts
        if (plan.isFreeTrialPlan) {
          logger.info(`⏭️ Account ${account.id} is on free trial, skipping`);
          continue;
        }

        eligibleAccounts.push(account);
      }

      logger.info(`✅ ${eligibleAccounts.length} accounts eligible for auto-generation`);

      if (eligibleAccounts.length === 0) {
        logger.info('📭 No eligible accounts for auto-generation today');
        return;
      }

      // Calculate time distribution
      // Distribution window: 4:00 AM to 11:59 PM (PRODUCTION)
      const startHour = 4; // 4 AM
      const endHour = 23; // 11 PM (end at 23:59)
      const distributionMinutes = (endHour - startHour + 1) * 60 - 1; // 1079 minutes

      // Calculate interval between jobs
      const intervalMinutes = eligibleAccounts.length > 1 
        ? Math.floor(distributionMinutes / (eligibleAccounts.length - 1))
        : 0;

      // Ensure minimum 5 minute gap between jobs
      const effectiveInterval = Math.max(5, intervalMinutes);

      logger.info(`⏱️ Distribution: ${eligibleAccounts.length} accounts over ${distributionMinutes} minutes`);
      logger.info(`⏱️ Interval between jobs: ${effectiveInterval} minutes`);

      // Queue jobs with staggered delays
      const now = new Date();
      const baseTime = new Date(now);
      baseTime.setHours(startHour, 0, 0, 0);

      // If we're past 4 AM (cron triggered late or manual trigger), start from current time
      if (now.getTime() > baseTime.getTime()) {
        baseTime.setTime(now.getTime());
      }

      for (let i = 0; i < eligibleAccounts.length; i++) {
        const account: DvybAccount = eligibleAccounts[i]!;
        
        // Calculate delay in milliseconds
        const delayMinutes = i * effectiveInterval;
        const scheduledTime = new Date(baseTime.getTime() + delayMinutes * 60 * 1000);
        const delayMs = scheduledTime.getTime() - Date.now();

        // Skip if scheduled time is past end of window
        if (scheduledTime.getHours() > endHour) {
          logger.warn(`⚠️ Account ${account.id} scheduled too late (${scheduledTime.toLocaleTimeString()}), adjusting`);
          // Queue with random delay within remaining window
          const randomMinutes = Math.floor(Math.random() * 60);
          const adjustedDelay = Math.max(0, delayMs - randomMinutes * 60 * 1000);
          await queueAutoGeneration(account.id, adjustedDelay);
        } else {
          await queueAutoGeneration(account.id, Math.max(0, delayMs));
        }

        // Update account with scheduled time
        const timeString = scheduledTime.toTimeString().split(' ')[0] || '';
        account.autoGenerationTime = timeString;
        account.autoGenerationStatus = 'pending';
        await accountRepo.save(account);

        logger.info(`📅 Account ${account.id} (${account.accountName}) scheduled for ${scheduledTime.toLocaleTimeString()}`);
      }

      // Log queue status
      const queueStatus = await getAutoGenerationQueueStatus();
      logger.info(`📊 Auto-generation queue status:`);
      logger.info(`   - Delayed: ${queueStatus.delayed}`);
      logger.info(`   - Active: ${queueStatus.active}`);
      logger.info(`   - Waiting: ${queueStatus.waiting}`);

      logger.info(`✅ Scheduled ${eligibleAccounts.length} auto-generation jobs`);

    } catch (error: any) {
      logger.error(`❌ Error scheduling auto-generations: ${error.message}`);
      throw error;
    }
  }

  /**
   * Manually trigger auto-generation scheduling (for testing)
   */
  async triggerNow(): Promise<{ scheduled: number; eligible: number }> {
    logger.info('🔧 Manually triggering auto-generation scheduling...');
    
    await this.scheduleAutoGenerations();
    
    const queueStatus = await getAutoGenerationQueueStatus();
    
    return {
      scheduled: queueStatus.delayed + queueStatus.waiting,
      eligible: queueStatus.delayed + queueStatus.waiting + queueStatus.active,
    };
  }
}

export const dvybAutoGenerationCronService = new DvybAutoGenerationCronService();

