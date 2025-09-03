import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../config/database';
import { Admin } from '../models/Admin';
import { logger } from '../config/logger';

// JWT Secret - should match the one used in admin routes
const JWT_SECRET = process.env.JWT_SECRET || 'admin-secret-key-burnie-2025';

// Extend Request type to include admin
declare global {
  namespace Express {
    interface Request {
      admin?: Admin;
    }
  }
}

// Middleware to verify admin token
export const isAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      res.status(401).json({
        success: false,
        message: 'No admin token provided',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const adminRepository = AppDataSource.getRepository(Admin);
    const admin = await adminRepository.findOne({
      where: { id: decoded.adminId, is_active: true }
    });

    if (!admin) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired admin token',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.admin = admin;
    next();
  } catch (error) {
    logger.error('Admin authentication error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid admin token',
      timestamp: new Date().toISOString(),
    });
    return;
  }
};
