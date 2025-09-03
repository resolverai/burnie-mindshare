import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { ContentRequest, ContentRequestStatus } from '../models/ContentRequest';
import { User } from '../models/User';
import { logger } from '../config/logger';

export class ContentRequestController {
  // Create a new content request
  static async createContentRequest(req: Request, res: Response): Promise<void> {
    try {
      const { projectName, platform, campaignLinks, walletAddress } = req.body;

      if (!projectName || !platform || !campaignLinks) {
        res.status(400).json({
          success: false,
          message: 'Project name, platform, and campaign links are required'
        });
        return;
      }

      const contentRequestRepository = AppDataSource.getRepository(ContentRequest);

      // Find user by wallet address if provided
      let user = null;
      if (walletAddress) {
        const userRepository = AppDataSource.getRepository(User);
        user = await userRepository.findOne({ where: { walletAddress } });
      }

      const contentRequestData: any = {
        projectName,
        platform,
        campaignLinks,
        walletAddress,
        status: ContentRequestStatus.REQUESTED
      };

      if (user?.id) {
        contentRequestData.userId = user.id.toString();
      }

      const contentRequest = contentRequestRepository.create(contentRequestData);

      const savedRequest = await contentRequestRepository.save(contentRequest);

      // Handle both single entity and array return types from TypeORM save
      const request = Array.isArray(savedRequest) ? savedRequest[0] : savedRequest;
      if (request) {
        logger.info(`New content request created: ${request.id} for project: ${projectName}`);
      }

      res.status(201).json({
        success: true,
        data: savedRequest,
        message: 'Content request submitted successfully'
      });
    } catch (error) {
      logger.error('Error creating content request:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get all content requests (for admin)
  static async getAllContentRequests(req: Request, res: Response): Promise<void> {
    try {
      const { page = 1, limit = 10, search, status } = req.query;
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const offset = (pageNum - 1) * limitNum;

      const contentRequestRepository = AppDataSource.getRepository(ContentRequest);
      const queryBuilder = contentRequestRepository
        .createQueryBuilder('contentRequest')
        .leftJoinAndSelect('contentRequest.user', 'user')
        .orderBy('contentRequest.createdAt', 'DESC');

      // Apply search filter
      if (search) {
        queryBuilder.where(
          '(contentRequest.projectName ILIKE :search OR contentRequest.platform ILIKE :search OR contentRequest.walletAddress ILIKE :search)',
          { search: `%${search}%` }
        );
      }

      // Apply status filter
      if (status) {
        queryBuilder.andWhere('contentRequest.status = :status', { status });
      }

      // Apply pagination
      queryBuilder.skip(offset).take(limitNum);

      const [contentRequests, total] = await queryBuilder.getManyAndCount();

      res.json({
        success: true,
        data: {
          contentRequests,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum)
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching content requests:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get content requests by wallet address
  static async getContentRequestsByWallet(req: Request, res: Response): Promise<void> {
    try {
      const { walletAddress } = req.params;
      const { page = 1, limit = 10 } = req.query;
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const offset = (pageNum - 1) * limitNum;

      const contentRequestRepository = AppDataSource.getRepository(ContentRequest);
      const queryBuilder = contentRequestRepository
        .createQueryBuilder('contentRequest')
        .leftJoinAndSelect('contentRequest.user', 'user')
        .where('contentRequest.walletAddress = :walletAddress', { walletAddress })
        .orderBy('contentRequest.createdAt', 'DESC')
        .skip(offset)
        .take(limitNum);

      const [contentRequests, total] = await queryBuilder.getManyAndCount();

      res.json({
        success: true,
        data: {
          contentRequests,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum)
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching content requests by wallet:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Update content request status (admin only)
  static async updateContentRequestStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status, adminNotes, generatedContent } = req.body;

      if (!id) {
        res.status(400).json({
          success: false,
          message: 'Content request ID is required'
        });
        return;
      }

      if (!Object.values(ContentRequestStatus).includes(status)) {
        res.status(400).json({
          success: false,
          message: 'Invalid status value'
        });
        return;
      }

      const contentRequestRepository = AppDataSource.getRepository(ContentRequest);
      const contentRequest = await contentRequestRepository.findOne({ where: { id } });

      if (!contentRequest) {
        res.status(404).json({
          success: false,
          message: 'Content request not found'
        });
        return;
      }

      contentRequest.status = status;
      if (adminNotes !== undefined) contentRequest.adminNotes = adminNotes;
      if (generatedContent !== undefined) contentRequest.generatedContent = generatedContent;

      const updatedRequest = await contentRequestRepository.save(contentRequest);

      logger.info(`Content request ${id} status updated to: ${status}`);

      res.json({
        success: true,
        data: updatedRequest,
        message: 'Content request status updated successfully'
      });
    } catch (error) {
      logger.error('Error updating content request status:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get content request by ID
  static async getContentRequestById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          message: 'Content request ID is required'
        });
        return;
      }

      const contentRequestRepository = AppDataSource.getRepository(ContentRequest);
      const contentRequest = await contentRequestRepository.findOne({
        where: { id },
        relations: ['user']
      });

      if (!contentRequest) {
        res.status(404).json({
          success: false,
          message: 'Content request not found'
        });
        return;
      }

      res.json({
        success: true,
        data: contentRequest
      });
    } catch (error) {
      logger.error('Error fetching content request by ID:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Delete content request (admin only)
  static async deleteContentRequest(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          message: 'Content request ID is required'
        });
        return;
      }

      const contentRequestRepository = AppDataSource.getRepository(ContentRequest);
      const contentRequest = await contentRequestRepository.findOne({ where: { id } });

      if (!contentRequest) {
        res.status(404).json({
          success: false,
          message: 'Content request not found'
        });
        return;
      }

      await contentRequestRepository.remove(contentRequest);

      logger.info(`Content request ${id} deleted`);

      res.json({
        success: true,
        message: 'Content request deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting content request:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
}
