import { Router } from 'express';
import { ContentRequestController } from '../controllers/ContentRequestController';
import { authenticateToken } from '../middleware/auth';
import { isAdmin } from '../middleware/adminAuth';

const router = Router();

// Public routes
router.post('/content-requests', ContentRequestController.createContentRequest);

// Protected routes (require authentication)
router.get('/content-requests/wallet/:walletAddress', authenticateToken, ContentRequestController.getContentRequestsByWallet);

// Admin routes (require admin authentication)
router.get('/admin/content-requests', authenticateToken, isAdmin, ContentRequestController.getAllContentRequests);
router.get('/admin/content-requests/:id', authenticateToken, isAdmin, ContentRequestController.getContentRequestById);
router.put('/admin/content-requests/:id/status', authenticateToken, isAdmin, ContentRequestController.updateContentRequestStatus);
router.delete('/admin/content-requests/:id', authenticateToken, isAdmin, ContentRequestController.deleteContentRequest);

export default router;
