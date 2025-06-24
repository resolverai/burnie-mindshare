import { AppDataSource } from '../config/database';
import { Campaign } from '../models/Campaign';
import { Project } from '../models/Project';
import { logger } from '../config/logger';
import { Repository } from 'typeorm';

export class CampaignService {
  private campaignRepository?: Repository<Campaign>;
  private projectRepository?: Repository<Project>;

  constructor() {
    if (AppDataSource.isInitialized) {
      this.campaignRepository = AppDataSource.getRepository(Campaign);
      this.projectRepository = AppDataSource.getRepository(Project);
    }
  }

  async listCampaigns(options: {
    page?: number;
    size?: number;
    status?: string;
    type?: string;
    search?: string;
  } = {}): Promise<any> {
    try {
      const { page = 1, size = 10, status, type, search } = options;

      if (this.campaignRepository) {
        const query = this.campaignRepository.createQueryBuilder('campaign')
          .leftJoinAndSelect('campaign.project', 'project')
          .leftJoinAndSelect('campaign.user', 'user');

        if (status) {
          query.andWhere('campaign.status = :status', { status: status.toUpperCase() });
        }

        if (type) {
          query.andWhere('campaign.campaignType = :type', { type: type.toUpperCase() });
        }

        if (search) {
          query.andWhere(
            '(LOWER(campaign.title) LIKE LOWER(:search) OR LOWER(campaign.description) LIKE LOWER(:search))',
            { search: `%${search}%` }
          );
        }

        query.orderBy('campaign.createdAt', 'DESC');

        const [campaigns, total] = await query
          .skip((page - 1) * size)
          .take(size)
          .getManyAndCount();

        return {
          data: campaigns.map(campaign => ({
            id: campaign.id,
            title: campaign.title,
            description: campaign.description,
            category: campaign.category,
            campaignType: campaign.campaignType,
            status: campaign.status,
            rewardPool: campaign.rewardPool,
            entryFee: campaign.entryFee,
            maxSubmissions: campaign.maxSubmissions,
            currentSubmissions: campaign.currentSubmissions,
            startDate: campaign.startDate,
            endDate: campaign.endDate,
            projectName: campaign.project?.name,
            createdAt: campaign.createdAt,
          })),
          total,
          page,
          size,
          totalPages: Math.ceil(total / size),
        };
      }

      // Return empty result if no database
      return {
        data: [],
        total: 0,
        page: options.page || 1,
        size: options.size || 10,
        totalPages: 0,
      };
    } catch (error) {
      logger.error('❌ Failed to list campaigns:', error);
      return {
        data: [],
        total: 0,
        page: options.page || 1,
        size: options.size || 10,
        totalPages: 0,
      };
    }
  }

  async getActiveCampaigns(): Promise<any[]> {
    try {
      if (this.campaignRepository) {
        const campaigns = await this.campaignRepository.find({
          where: { status: 'ACTIVE' as any },
          relations: ['project'],
          order: { createdAt: 'DESC' },
          take: 10,
        });

        return campaigns.map(campaign => ({
          id: campaign.id,
          title: campaign.title,
          description: campaign.description,
          campaignType: campaign.campaignType,
          status: campaign.status,
          rewardPool: campaign.rewardPool,
          entryFee: campaign.entryFee,
          maxSubmissions: campaign.maxSubmissions,
          currentSubmissions: campaign.currentSubmissions,
          endDate: campaign.endDate,
          projectName: campaign.project?.name,
        }));
      }

      // Return empty array if no database
      return [];
    } catch (error) {
      logger.error('❌ Failed to get active campaigns:', error);
      return [];
    }
  }

  async getCampaign(id: number): Promise<any> {
    try {
      if (this.campaignRepository) {
        const campaign = await this.campaignRepository.findOne({
          where: { id },
          relations: ['project', 'user', 'submissions', 'submissions.miner'],
        });

        if (campaign) {
          return {
            ...campaign,
            submissions: campaign.submissions?.map(sub => ({
              id: sub.id,
              content: sub.content.substring(0, 100) + '...',
              status: sub.status,
              totalScore: sub.totalScore,
              minerName: sub.miner?.username,
              createdAt: sub.createdAt,
            })),
          };
        }
      }

      // Return null if not found or no database
      return null;
    } catch (error) {
      logger.error('❌ Failed to get campaign:', error);
      throw error;
    }
  }
} 