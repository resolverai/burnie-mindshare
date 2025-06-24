import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../config/logger';
import { MinerHeartbeat, SocketEvent } from '../types/index';
import { initializeWebSocketManager, getWebSocketManager } from '../services/WebSocketManager';

interface AuthenticatedSocket extends Socket {
  minerId?: number;
  walletAddress?: string;
}

// Store active miners
const activeMinerSockets = new Map<number, AuthenticatedSocket>();
const minerRooms = new Map<number, string>();

export const initializeWebSocket = (io: SocketIOServer): void => {
  logger.info('🔌 Initializing WebSocket server...');
  logger.info('🔧 WebSocket server listening for connections');
  
  // Initialize WebSocket manager
  const wsManager = initializeWebSocketManager(io);

  // Handle default namespace connections
  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`🔗 Client connected: ${socket.id} from ${socket.handshake.address}`);
    logger.info(`📊 Total connections: ${io.sockets.sockets.size}`);

    // Send connection confirmation
    socket.emit('connected', {
      success: true,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
    logger.info(`✅ Connection confirmation sent to ${socket.id}`);

    // Handle miner authentication
    socket.on('authenticate', (data: { minerId: number; walletAddress: string }) => {
      try {
        logger.info(`🔐 Authentication request from ${socket.id}:`, data);
        const { minerId, walletAddress } = data;
        
        if (!minerId || !walletAddress) {
          logger.error(`❌ Invalid authentication data from ${socket.id}:`, data);
          socket.emit('authError', { message: 'Invalid authentication data' });
          return;
        }
        
        socket.minerId = minerId;
        socket.walletAddress = walletAddress;
        
        // Join miner room
        const roomName = `miner_${minerId}`;
        socket.join(roomName);
        
        // Store socket reference
        activeMinerSockets.set(minerId, socket);
        minerRooms.set(minerId, roomName);
        
        logger.info(`✅ Miner authenticated: ${minerId} (${walletAddress}) - Room: ${roomName}`);
        logger.info(`📊 Active miners: ${activeMinerSockets.size}`);
        
        socket.emit('authenticated', {
          success: true,
          minerId,
          message: 'Authentication successful',
        });

        // Broadcast miner online status using WebSocket manager
        wsManager.broadcastMinerStatus(minerId, 'ONLINE');

      } catch (error) {
        logger.error(`❌ Authentication error for ${socket.id}:`, error);
        socket.emit('authError', { message: 'Authentication failed' });
      }
    });

    // Handle join_miner event for compatibility
    socket.on('join_miner', (data: { miner_id: number; wallet_address?: string }) => {
      try {
        logger.info(`🔐 Join miner request from ${socket.id}:`, data);
        const { miner_id, wallet_address } = data;
        
        if (!miner_id) {
          logger.error(`❌ Invalid miner ID from ${socket.id}:`, data);
          socket.emit('error', { message: 'Invalid miner ID' });
          return;
        }
        
        socket.minerId = miner_id;
        socket.walletAddress = wallet_address || socket.id; // Use socket.id as fallback
        
        // Join miner room
        const roomName = `miner_${miner_id}`;
        socket.join(roomName);
        
        // Store socket reference
        activeMinerSockets.set(miner_id, socket);
        minerRooms.set(miner_id, roomName);
        
        logger.info(`✅ Miner joined: ${miner_id} (${wallet_address || socket.id}) - Room: ${roomName}`);
        logger.info(`📊 Active miners: ${activeMinerSockets.size}`);
        
        socket.emit('joined_miner', {
          success: true,
          minerId: miner_id,
          message: 'Joined miner room successfully',
        });

        // Broadcast miner online status
        wsManager.broadcastMinerStatus(miner_id, 'ONLINE');

      } catch (error) {
        logger.error(`❌ Join miner error for ${socket.id}:`, error);
        socket.emit('error', { message: 'Failed to join miner room' });
      }
    });

    // Handle heartbeat
    socket.on('heartbeat', (data: MinerHeartbeat) => {
      try {
        if (!socket.minerId) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        logger.debug(`💓 Heartbeat from miner ${socket.minerId}:`, data);

        // Update miner status in database here
        // TODO: Add database update logic

        // Broadcast status update using WebSocket manager
        wsManager.broadcastMinerStatus(socket.minerId, data.status);

        socket.emit('heartbeatAck', {
          timestamp: new Date().toISOString(),
        });

      } catch (error) {
        logger.error('❌ Heartbeat error:', error);
        socket.emit('error', { message: 'Heartbeat failed' });
      }
    });

    // Handle content submission
    socket.on('contentSubmission', (data: any) => {
      try {
        if (!socket.minerId) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        logger.info(`📝 Content submission from miner ${socket.minerId}`);

        // Process submission here
        // TODO: Add submission processing logic

        // Generate submission ID and broadcast using WebSocket manager
        const submissionId = Date.now();
        wsManager.broadcastNewSubmission(submissionId);

        socket.emit('submissionReceived', {
          success: true,
          submissionId,
          timestamp: new Date().toISOString(),
        });

      } catch (error) {
        logger.error('❌ Submission error:', error);
        socket.emit('error', { message: 'Submission failed' });
      }
    });

    // Handle campaign updates request
    socket.on('getCampaigns', () => {
      try {
        // TODO: Fetch campaigns from database
        const mockCampaigns = [
          {
            id: 1,
            title: 'Roast the Competition 🔥',
            type: 'roast',
            rewardPool: 50000,
            status: 'ACTIVE',
            currentSubmissions: 342,
            maxSubmissions: 1500,
            endDate: new Date(Date.now() + 6 * 86400000).toISOString(),
          },
          {
            id: 2,
            title: 'Meme Magic Monday 🎭',
            type: 'meme',
            rewardPool: 25000,
            status: 'ACTIVE',
            currentSubmissions: 156,
            maxSubmissions: 1000,
            endDate: new Date(Date.now() + 86400000).toISOString(),
          },
          {
            id: 3,
            title: 'Creative Chaos Campaign 🎨',
            type: 'creative',
            rewardPool: 35000,
            status: 'ACTIVE',
            currentSubmissions: 89,
            maxSubmissions: 800,
            endDate: new Date(Date.now() + 3 * 86400000).toISOString(),
          },
        ];

        socket.emit('campaignsUpdate', {
          campaigns: mockCampaigns,
          timestamp: new Date().toISOString(),
        });

      } catch (error) {
        logger.error('❌ Get campaigns error:', error);
        socket.emit('error', { message: 'Failed to fetch campaigns' });
      }
    });

    // Handle dashboard authentication
    socket.on('authenticateDashboard', (data: { role: string; token?: string }) => {
      try {
        const { role, token } = data;
        
        if (role === 'dashboard') {
          socket.join('dashboard');
          
          logger.info(`📊 Dashboard connected: ${socket.id}`);
          
          socket.emit('dashboardAuthenticated', {
            success: true,
            timestamp: new Date().toISOString(),
          });

          // Send current system stats
          socket.emit('systemStats', {
            activeMiners: activeMinerSockets.size,
            totalConnections: io.sockets.sockets.size,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        logger.error('❌ Dashboard authentication error:', error);
        socket.emit('authError', { message: 'Dashboard authentication failed' });
      }
    });

    // Handle AI analysis results
    socket.on('aiAnalysisComplete', (data: any) => {
      try {
        const { submissionId, minerId, scores, analysis } = data;
        
        logger.info(`🤖 AI analysis complete for submission ${submissionId}`);

        // Notify the specific miner
        const minerSocket = activeMinerSockets.get(minerId);
        if (minerSocket) {
          minerSocket.emit('submissionAnalyzed', {
            submissionId,
            scores,
            analysis,
            timestamp: new Date().toISOString(),
          });
        }

        // Notify dashboard
        io.to('dashboard').emit('analysisComplete', {
          submissionId,
          minerId,
          totalScore: scores.total,
          timestamp: new Date().toISOString(),
        });

      } catch (error) {
        logger.error('❌ AI analysis broadcast error:', error);
      }
    });

    // Handle reward notifications
    socket.on('rewardEarned', (data: any) => {
      try {
        const { minerId, amount, submissionId, blockId } = data;
        
        logger.info(`💰 Reward earned by miner ${minerId}: ${amount} ROAST`);

        // Notify specific miner
        const minerSocket = activeMinerSockets.get(minerId);
        if (minerSocket) {
          minerSocket.emit('rewardNotification', {
            amount,
            submissionId,
            blockId,
            timestamp: new Date().toISOString(),
          });
        }

        // Notify dashboard
        io.to('dashboard').emit('rewardDistributed', {
          minerId,
          amount,
          submissionId,
          blockId,
          timestamp: new Date().toISOString(),
        });

      } catch (error) {
        logger.error('❌ Reward notification error:', error);
      }
    });

    // Handle system alerts
    socket.on('systemAlert', (data: any) => {
      try {
        const { type, message, level } = data;
        
        // Broadcast to all dashboard connections
        io.to('dashboard').emit('systemAlert', {
          type,
          message,
          level,
          timestamp: new Date().toISOString(),
        });

        logger.info(`🚨 System alert: ${type} - ${message}`);

      } catch (error) {
        logger.error('❌ System alert error:', error);
      }
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      logger.info(`🔌 Client disconnected: ${socket.id} - Reason: ${reason}`);
      
      // Clean up miner data
      if (socket.minerId) {
        activeMinerSockets.delete(socket.minerId);
        minerRooms.delete(socket.minerId);
        logger.info(`🧹 Cleaned up data for miner ${socket.minerId}`);
        
        // Broadcast miner offline status
        wsManager.broadcastMinerStatus(socket.minerId, 'OFFLINE');
      }
      
      logger.info(`📊 Total connections: ${io.sockets.sockets.size}`);
      logger.info(`📊 Active miners: ${activeMinerSockets.size}`);
    });

    // Handle connection errors
    socket.on('error', (error) => {
      logger.error(`❌ Socket error for ${socket.id}:`, error);
    });
  });

  // Periodic cleanup of stale connections
  setInterval(() => {
    const staleConnections = Array.from(activeMinerSockets.entries()).filter(
      ([minerId, socket]) => !socket.connected
    );

    staleConnections.forEach(([minerId]) => {
      activeMinerSockets.delete(minerId);
      minerRooms.delete(minerId);
      logger.info(`🧹 Cleaned up stale connection for miner ${minerId}`);
    });
  }, 30000); // Every 30 seconds

  // Periodic stats broadcast to dashboard
  setInterval(() => {
    const dashboardRoom = io.sockets.adapter.rooms.get('dashboard');
    if (dashboardRoom && dashboardRoom.size > 0) {
      io.to('dashboard').emit('realtimeStats', {
        activeMiners: activeMinerSockets.size,
        totalConnections: io.sockets.sockets.size,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        timestamp: new Date().toISOString(),
      });
    }
  }, 10000); // Every 10 seconds

  logger.info('✅ WebSocket server initialized successfully');
};

// Utility functions for broadcasting
export const broadcastToMiner = (minerId: number, event: string, data: any): void => {
  const socket = activeMinerSockets.get(minerId);
  if (socket && socket.connected) {
    socket.emit(event, data);
  }
};

export const broadcastToAllMiners = (event: string, data: any): void => {
  activeMinerSockets.forEach((socket) => {
    if (socket.connected) {
      socket.emit(event, data);
    }
  });
};

export const getActiveMinerCount = (): number => {
  return Array.from(activeMinerSockets.values()).filter(
    (socket) => socket.connected
  ).length;
}; 