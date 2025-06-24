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

      // Fallback mock data
      return this.getMockCampaigns(options);
    } catch (error) {
      logger.error('❌ Failed to list campaigns:', error);
      return this.getMockCampaigns(options);
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

      // Fallback mock data
      return [
        {
          id: 1,
          title: 'Roast the Competition 🔥',
          description: 'Create savage roasts targeting competitor brands.',
          campaignType: 'roast',
          status: 'ACTIVE',
          rewardPool: 50000,
          entryFee: 100,
          maxSubmissions: 1500,
          currentSubmissions: 342,
          endDate: new Date(Date.now() + 6 * 86400000).toISOString(),
        },
        {
          id: 2,
          title: 'Meme Magic Monday 🎭',
          description: 'Generate viral memes for crypto trends.',
          campaignType: 'meme',
          status: 'ACTIVE',
          rewardPool: 25000,
          entryFee: 50,
          maxSubmissions: 1000,
          currentSubmissions: 156,
          endDate: new Date(Date.now() + 86400000).toISOString(),
        },
      ];
    } catch (error) {
      logger.error('❌ Failed to get active campaigns:', error);
      throw error;
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

      // Mock data fallback
      return {
        id,
        title: 'Roast the Competition 🔥',
        description: 'Create savage roasts targeting competitor brands.',
        status: 'ACTIVE',
        rewardPool: 50000,
        currentSubmissions: 342,
      };
    } catch (error) {
      logger.error('❌ Failed to get campaign:', error);
      throw error;
    }
  }

  private getMockCampaigns(options: any): any {
    const mockCampaigns = [
      {
        id: 1,
        title: 'Roast the Competition 🔥',
        description: 'Create savage roasts targeting competitor brands. Show no mercy in your humor!',
        category: 'Roasting',
        campaignType: 'roast',
        status: 'ACTIVE',
        rewardPool: 50000,
        entryFee: 100,
        maxSubmissions: 1500,
        currentSubmissions: 342,
        startDate: new Date(Date.now() - 86400000).toISOString(),
        endDate: new Date(Date.now() + 6 * 86400000).toISOString(),
        createdAt: new Date(Date.now() - 172800000).toISOString(),
      },
      {
        id: 2,
        title: 'Meme Magic Monday 🎭',
        description: 'Generate viral memes for the latest crypto trends. Make them laugh, make them share!',
        category: 'Memes',
        campaignType: 'meme',
        status: 'ACTIVE',
        rewardPool: 25000,
        entryFee: 50,
        maxSubmissions: 1000,
        currentSubmissions: 156,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 3,
        title: 'Creative Chaos Campaign 🎨',
        description: 'Unleash your creativity! Write stories, poems, or creative content with crypto themes.',
        category: 'Creative',
        campaignType: 'creative',
        status: 'ACTIVE',
        rewardPool: 35000,
        entryFee: 75,
        maxSubmissions: 800,
        currentSubmissions: 89,
        startDate: new Date(Date.now() - 43200000).toISOString(),
        endDate: new Date(Date.now() + 3 * 86400000).toISOString(),
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ];

    // Apply filtering for mock data
    let filtered = mockCampaigns;
    const { page = 1, size = 10, status, type, search } = options;

    if (status) {
      filtered = filtered.filter(c => c.status.toLowerCase() === status.toLowerCase());
    }
    if (type) {
      filtered = filtered.filter(c => c.campaignType.toLowerCase() === type.toLowerCase());
    }
    if (search) {
      filtered = filtered.filter(c =>
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        c.description.toLowerCase().includes(search.toLowerCase())
      );
    }

    const total = filtered.length;
    const startIndex = (page - 1) * size;
    const endIndex = startIndex + size;
    const paginatedData = filtered.slice(startIndex, endIndex);

    return {
      data: paginatedData,
      total,
      page,
      size,
      totalPages: Math.ceil(total / size),
    };
  }
} 