import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { User } from '../models/User';
import { AgentConfiguration, AgentType } from '../models/AgentConfiguration';
import { TwitterUserConnection } from '../models/TwitterUserConnection';
import { TwitterLearningService } from '../services/TwitterLearningService';
import { logger } from '../config/logger';

const router = Router();

interface CreateAgentRequest {
  name: string;
  personality: 'WITTY' | 'SAVAGE' | 'CHAOTIC' | 'LEGENDARY';
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  modelPreferences: {
    text: { provider: string; model: string; };
    image: { provider: string; model: string; };
    video: { provider: string; model: string; };
    audio: { provider: string; model: string; };
  };
  walletAddress: string;
}

interface UpdateAgentRequest {
  name?: string;
  personality?: 'WITTY' | 'SAVAGE' | 'CHAOTIC' | 'LEGENDARY';
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  modelPreferences?: {
    text: { provider: string; model: string; };
    image: { provider: string; model: string; };
    video: { provider: string; model: string; };
    audio: { provider: string; model: string; };
  };
}

// Initialize Twitter Learning Service
const twitterLearningService = new TwitterLearningService();

/**
 * GET /agents/user/:walletAddress
 * Get all agents for a user
 */
router.get('/user/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required',
        data: []
      });
    }
    
    logger.info(`🔍 Fetching agents for wallet: ${walletAddress}`);

    // Find user by wallet address and check Twitter connection
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        data: []
      });
    }

    // Check Twitter connection status properly
    const twitterConnection = await AppDataSource.getRepository('TwitterUserConnection').findOne({
      where: { userId: user.id, isConnected: true }
    });
    const hasTwitterConnected = !!twitterConnection;

    // Get all agent configurations for this user
    const agentRepository = AppDataSource.getRepository(AgentConfiguration);
    const agents = await agentRepository.find({
      where: { userId: user.id, isActive: true },
      order: { createdAt: 'DESC' }
    });

    // Transform to frontend format - show only user's single agent
    const transformedAgents = agents.map(agent => ({
      id: agent.id.toString(),
      name: agent.agentName, // Use the actual agent name, not the internal config name
      personality: agent.personalityType,
      level: agent.performanceMetrics?.level || 1,
      experience: agent.performanceMetrics?.experience || 0,
      maxExperience: 100,
      quality: agent.performanceMetrics?.qualityScore || 0,
      alignment: agent.performanceMetrics?.alignment || 50,
      learning: agent.performanceMetrics?.learningProgress || 0,
      status: agent.isActive ? 'ready' : 'offline',
      deploys: agent.performanceMetrics?.totalDeployments || 0,
      x_account_connected: hasTwitterConnected,
      system_message: agent.systemMessage || '',
      config: agent.configuration || {},
      agentType: 'personalized_agent', // Always show as personalized agent
      createdAt: agent.createdAt,
      lastUpdated: agent.updatedAt
    }));

    logger.info(`✅ Found ${agents.length} agent(s) for user ${user.id}`);

    return res.json({
      success: true,
      data: transformedAgents,
      count: transformedAgents.length
    });

  } catch (error) {
    logger.error('❌ Error fetching user agents:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      data: []
    });
  }
});

/**
 * POST /agents/create
 * Create a new agent and trigger Twitter learning
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const agentData: CreateAgentRequest = req.body;
    
    logger.info(`🤖 Creating agent for wallet: ${agentData.walletAddress}`);

    // Find or create user
    const userRepository = AppDataSource.getRepository(User);
    let user = await userRepository.findOne({ 
      where: { walletAddress: agentData.walletAddress.toLowerCase() }
    });

    if (!user) {
      // Create new user if doesn't exist
      user = new User();
      user.walletAddress = agentData.walletAddress.toLowerCase();
      user.roleType = 'miner' as any; // Type assertion for enum
      await userRepository.save(user);
      logger.info(`👤 Created new user for wallet: ${agentData.walletAddress}`);
    }

    // Create agent configuration for each agent type (5-agent constellation)
    const agentRepository = AppDataSource.getRepository(AgentConfiguration);
    
    // Allow multiple agents per user - removed single agent restriction
    logger.info(`🤖 Creating additional agent for user ${user.id}: ${agentData.name}`);

    // Create SINGLE agent that represents the user's personalized agent
    // The 5-agent constellation is handled internally in the configuration
    const agentConfig = new AgentConfiguration();
    agentConfig.userId = user.id;
    agentConfig.agentType = AgentType.ORCHESTRATOR; // Use orchestrator as the main type
    agentConfig.agentName = agentData.name;
    agentConfig.personalityType = agentData.personality as any;
    agentConfig.systemMessage = agentData.systemPrompt || `You are a ${agentData.personality} AI agent for generating content. Generate creative content that matches this personality while staying within appropriate bounds.`;
    
    // Store the 5-agent constellation configuration internally
    agentConfig.configuration = {
      // User-visible configuration
      name: agentData.name,
      personality: agentData.personality,
      systemPrompt: agentData.systemPrompt,
      temperature: agentData.temperature,
      maxTokens: agentData.maxTokens,
      modelPreferences: agentData.modelPreferences,
      createdBy: 'user',
      version: '1.0',
      
      // Internal 5-agent constellation (hidden from user)
      internalAgents: {
        dataAnalyst: {
          type: 'data_analyst',
          systemPrompt: generateAgentSpecificPrompt(AgentType.DATA_ANALYST, agentData.personality, agentData.systemPrompt),
          modelPreferences: agentData.modelPreferences
        },
        contentStrategist: {
          type: 'content_strategist', 
          systemPrompt: generateAgentSpecificPrompt(AgentType.CONTENT_STRATEGIST, agentData.personality, agentData.systemPrompt),
          modelPreferences: agentData.modelPreferences
        },
        textContent: {
          type: 'text_content',
          systemPrompt: generateAgentSpecificPrompt(AgentType.TEXT_CONTENT, agentData.personality, agentData.systemPrompt),
          modelPreferences: agentData.modelPreferences
        },
        visualCreator: {
          type: 'visual_creator',
          systemPrompt: generateAgentSpecificPrompt(AgentType.VISUAL_CREATOR, agentData.personality, agentData.systemPrompt),
          modelPreferences: agentData.modelPreferences
        },
        orchestrator: {
          type: 'orchestrator',
          systemPrompt: generateAgentSpecificPrompt(AgentType.ORCHESTRATOR, agentData.personality, agentData.systemPrompt),
          modelPreferences: agentData.modelPreferences
        }
      }
    };

    agentConfig.performanceMetrics = {
      level: 1,
      experience: 0,
      qualityScore: 0,
      alignment: 50,
      learningProgress: 0,
      totalDeployments: 0,
      successRate: 0,
      lastUpdated: new Date(),
      learningAccuracy: 0
    };

    agentConfig.isActive = true;

    const savedAgent = await agentRepository.save(agentConfig);
    
    logger.info(`✅ Created personalized agent for user ${user.id}: ${agentData.name}`);

    // **TRIGGER TWITTER LEARNING AUTOMATICALLY**
    logger.info(`🧠 Triggering Twitter learning for new personalized agent...`);
    try {
      await twitterLearningService.processUserTwitterData(user);
      logger.info(`✅ Twitter learning completed for user ${user.id}`);
    } catch (learningError) {
      logger.error(`⚠️ Twitter learning failed for user ${user.id}:`, learningError);
      // Don't fail agent creation if learning fails
    }

    // Transform response - show only the single user agent
    const responseAgent = {
      id: savedAgent.id.toString(),
      name: savedAgent.agentName,
      personality: savedAgent.personalityType,
      level: 1,
      experience: 0,
      maxExperience: 100,
      quality: 0,
      alignment: 50,
      learning: 0,
      status: 'ready',
      deploys: 0,
      x_account_connected: !!user.twitterHandle,
      system_message: savedAgent.systemMessage || '',
      config: savedAgent.configuration || {},
      agentType: 'personalized_agent',
      createdAt: savedAgent.createdAt
    };

    logger.info(`🎉 Successfully created personalized agent for user ${user.id}`);

    return res.json({
      success: true,
      message: 'Personalized agent created successfully',
      data: [responseAgent],
      learningTriggered: true
    });

  } catch (error) {
    logger.error('❌ Error creating agent:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create agent',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /agents/update-learning/:walletAddress
 * Manually trigger learning update for user's agents (legacy - updates all agents)
 */
router.post('/update-learning/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required'
      });
    }
    
    logger.info(`🔄 Manual learning update triggered for wallet: ${walletAddress}`);

    // Find user
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Trigger Twitter learning
    await twitterLearningService.processUserTwitterData(user);

    logger.info(`✅ Learning update completed for user ${user.id}`);

    return res.json({
      success: true,
      message: 'Learning updated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ Error updating learning:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update learning',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /agents/:agentId/update-learning
 * Manually trigger learning update for a specific agent
 */
router.post('/:agentId/update-learning', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    
    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'Agent ID is required'
      });
    }
    
    logger.info(`🔄 Per-agent learning update triggered for agent: ${agentId}`);

    // Find agent and user
    const agentRepository = AppDataSource.getRepository(AgentConfiguration);
    const agent = await agentRepository.findOne({ 
      where: { id: parseInt(agentId), isActive: true },
      relations: ['user']
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    // Get user for this agent
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { id: agent.userId }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found for this agent'
      });
    }

    logger.info(`🧠 Triggering Twitter learning for agent ${agentId} (${agent.agentName})`);

    // Trigger Twitter learning for this user (affects all agents but triggered by specific agent)
    await twitterLearningService.processUserTwitterData(user);

    logger.info(`✅ Learning update completed for agent ${agentId}`);

    // Get updated agent data
    const updatedAgent = await agentRepository.findOne({ 
      where: { id: parseInt(agentId), isActive: true }
    });

    return res.json({
      success: true,
      message: `Learning updated successfully for agent: ${agent.agentName}`,
      timestamp: new Date().toISOString(),
      agent: {
        id: agentId,
        name: agent.agentName,
        learningProgress: updatedAgent?.performanceMetrics?.learningProgress || 0,
        lastUpdated: updatedAgent?.performanceMetrics?.lastUpdated || new Date()
      }
    });

  } catch (error) {
    logger.error(`❌ Error updating learning for agent ${req.params.agentId}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update learning',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /agents/debug-learning/:walletAddress
 * Debug endpoint to check learning data and source of learning progress
 */
router.get('/debug-learning/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required'
      });
    }

    // Find user
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Get agent configurations
    const agentConfigs = await twitterLearningService.getUserAgentConfigurations(user.id);
    
    // Count learning data
    const learningDataRepo = AppDataSource.getRepository('TwitterLearningData');
    const learningDataCount = await learningDataRepo.count({
      where: { userId: user.id }
    });

    // Get recent learning data
    const recentLearningData = await learningDataRepo.find({
      where: { userId: user.id },
      order: { processedAt: 'DESC' },
      take: 10
    });

    // Check Twitter connection
    const twitterConnectionRepo = AppDataSource.getRepository('TwitterUserConnection');
    const twitterConnection = await twitterConnectionRepo.findOne({
      where: { userId: user.id, isConnected: true }
    });

    res.json({
      success: true,
      debug: {
        userId: user.id,
        walletAddress: user.walletAddress,
        twitterHandle: user.twitterHandle,
        twitterConnected: !!twitterConnection,
        twitterUserId: twitterConnection?.twitterUserId,
        agentCount: agentConfigs.length,
        learningDataCount: learningDataCount,
        agents: agentConfigs.map(agent => ({
          id: agent.id,
          name: agent.agentName,
          learningProgress: agent.performanceMetrics?.learningProgress || 0,
          lastUpdated: agent.performanceMetrics?.lastUpdated,
          createdAt: agent.createdAt
        })),
        recentLearningData: recentLearningData.map(data => ({
          id: data.id,
          tweetId: data.tweetId,
          analysisType: data.analysisType,
          confidence: data.confidence,
          processedAt: data.processedAt,
          hasInsights: !!data.insights
        })),
        learningProgressSource: agentConfigs.length > 0 ? 
          `Agent DB: ${agentConfigs[0]?.performanceMetrics?.learningProgress || 0}%` : 
          'No agents found'
      }
    });

  } catch (error) {
    logger.error('❌ Error in debug learning endpoint:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch debug learning data'
    });
  }
});

/**
 * GET /agents/:agentId/learning-status
 * Get learning status for a specific agent
 */
router.get('/:agentId/learning-status', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'Agent ID is required'
      });
    }

    // Find agent
    const agentRepository = AppDataSource.getRepository(AgentConfiguration);
    const agent = await agentRepository.findOne({ 
      where: { id: parseInt(agentId), isActive: true }
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    // Get user for this agent
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { id: agent.userId }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found for this agent'
      });
    }

    // Check Twitter connection status
    const twitterConnectionRepo = AppDataSource.getRepository('TwitterUserConnection');
    const twitterConnection = await twitterConnectionRepo.findOne({
      where: { userId: user.id, isConnected: true }
    });

    // Count actual tweets processed (not database records)
    const learningDataRepo = AppDataSource.getRepository('TwitterLearningData');
    
    // Get master summary records to count actual tweets
    const masterSummaries = await learningDataRepo.find({
      where: { 
        userId: user.id,
        analysisType: 'master_agent_constellation'
      },
      order: { processedAt: 'DESC' }
    });

    // Extract tweet count from the most recent master summary
    let totalTweetsProcessed = 0;
    if (masterSummaries.length > 0) {
      const latestSummary = masterSummaries[0];
      totalTweetsProcessed = latestSummary?.insights?.totalTweetsProcessed || 0;
    }

    // Get agent's learning progress
    const learningProgress = agent.performanceMetrics?.learningProgress || 0;
    const lastUpdated = agent.performanceMetrics?.lastUpdated || agent.updatedAt;

    let status = 'no_twitter';
    let message = 'Connect Twitter to start learning';

    if (!twitterConnection) {
      status = 'no_twitter';
      message = 'Connect Twitter to start learning';
    } else if (totalTweetsProcessed === 0) {
      status = 'twitter_connected';
      message = 'Twitter connected • Ready for learning';
    } else {
      status = 'learning_complete';
      message = `Trained on ${totalTweetsProcessed} tweets • Agent ready`;
    }

    return res.json({
      success: true,
      data: {
        agentId: agentId,
        agentName: agent.agentName,
        hasLearningData: totalTweetsProcessed > 0,
        twitterConnected: !!twitterConnection,
        learningDataCount: totalTweetsProcessed,
        learningProgress: learningProgress,
        lastUpdated: lastUpdated,
        status: status,
        message: message
      }
    });

  } catch (error) {
    logger.error(`❌ Error fetching learning status for agent ${req.params.agentId}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch agent learning status'
    });
  }
});

/**
 * GET /agents/learning-status/:walletAddress
 * Get learning status and insights for user (legacy)
 */
router.get('/learning-status/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required'
      });
    }

    // Find user
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check Twitter connection status
    const twitterConnectionRepo = AppDataSource.getRepository('TwitterUserConnection');
    const twitterConnection = await twitterConnectionRepo.findOne({
      where: { userId: user.id, isConnected: true }
    });

    // Get agent configurations first to check if agents exist
    const agentConfigs = await twitterLearningService.getUserAgentConfigurations(user.id);
    
    // Get learning insights and data count
    const insights = await twitterLearningService.getUserLearningInsights(user.id);
    
    // Count actual tweets processed (not database records)
    const learningDataRepo = AppDataSource.getRepository('TwitterLearningData');
    
    // Get master summary records to count actual tweets
    const masterSummaries = await learningDataRepo.find({
      where: { 
        userId: user.id,
        analysisType: 'master_agent_constellation'
      },
      order: { processedAt: 'DESC' }
    });

    // Extract tweet count from the most recent master summary
    let totalTweetsProcessed = 0;
    if (masterSummaries.length > 0) {
      const latestSummary = masterSummaries[0];
      totalTweetsProcessed = latestSummary?.insights?.totalTweetsProcessed || 0;
    }

    let status = 'no_twitter';
    let message = 'Connect Twitter to start learning';
    let learningProgress = 0;

    if (!twitterConnection) {
      // No Twitter connected
      status = 'no_twitter';
      message = 'Connect Twitter to start learning';
      learningProgress = 0;
    } else if (agentConfigs.length === 0) {
      // Twitter connected but no agents created yet
      status = 'twitter_connected';
      message = 'Twitter connected • Learning will start when you create an agent';
      learningProgress = 0; // Should be 0 until agent is created
    } else if (totalTweetsProcessed > 0) {
      // Agents exist and learning data is available
      status = 'learning_complete';
      message = `Trained on ${totalTweetsProcessed} tweets • Agent ready`;
      // Get learning progress from the actual agent
      const firstAgent = agentConfigs[0];
      learningProgress = firstAgent?.performanceMetrics?.learningProgress || Math.min(totalTweetsProcessed * 2, 100);
    } else {
      // Agents exist but no learning data yet (learning in progress)
      status = 'learning_in_progress';
      message = 'Agent created • Twitter learning in progress...';
      learningProgress = 10; // Show minimal progress for agent creation
    }

    return res.json({
      success: true,
      data: {
        hasLearningData: totalTweetsProcessed > 0,
        twitterConnected: !!twitterConnection,
        learningDataCount: totalTweetsProcessed,
        insights: insights,
        agentConfigurations: agentConfigs.length,
        lastUpdated: agentConfigs[0]?.updatedAt || null,
        status: status,
        message: message,
        learningProgress: learningProgress
      }
    });

  } catch (error) {
    logger.error('❌ Error fetching learning status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch learning status'
    });
  }
});

/**
 * PUT /agents/:agentId/update
 * Update specific agent configuration and trigger learning
 */
router.put('/:agentId/update', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const updateData: UpdateAgentRequest = req.body;
    
    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'Agent ID is required'
      });
    }
    
    logger.info(`🔄 Updating agent configuration for agent: ${agentId}`);

    // Find the specific agent
    const agentRepository = AppDataSource.getRepository(AgentConfiguration);
    const agent = await agentRepository.findOne({
      where: { id: parseInt(agentId), isActive: true }
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    // Get user for this agent
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { id: agent.userId }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found for this agent'
      });
    }

    // Update agent configuration
    if (updateData.name) agent.agentName = updateData.name;
    if (updateData.personality) agent.personalityType = updateData.personality as any;
    if (updateData.systemPrompt) agent.systemMessage = updateData.systemPrompt;
    
    // Update the configuration object
    agent.configuration = {
      ...agent.configuration,
      ...updateData,
      updatedAt: new Date().toISOString(),
      
             // Update internal agents configuration
       internalAgents: {
         dataAnalyst: {
           type: 'data_analyst',
           systemPrompt: generateAgentSpecificPrompt(AgentType.DATA_ANALYST, (updateData.personality || agent.personalityType) as string, updateData.systemPrompt || agent.systemMessage || ''),
           modelPreferences: updateData.modelPreferences || agent.configuration?.modelPreferences
         },
         contentStrategist: {
           type: 'content_strategist', 
           systemPrompt: generateAgentSpecificPrompt(AgentType.CONTENT_STRATEGIST, (updateData.personality || agent.personalityType) as string, updateData.systemPrompt || agent.systemMessage || ''),
           modelPreferences: updateData.modelPreferences || agent.configuration?.modelPreferences
         },
         textContent: {
           type: 'text_content',
           systemPrompt: generateAgentSpecificPrompt(AgentType.TEXT_CONTENT, (updateData.personality || agent.personalityType) as string, updateData.systemPrompt || agent.systemMessage || ''),
           modelPreferences: updateData.modelPreferences || agent.configuration?.modelPreferences
         },
         visualCreator: {
           type: 'visual_creator',
           systemPrompt: generateAgentSpecificPrompt(AgentType.VISUAL_CREATOR, (updateData.personality || agent.personalityType) as string, updateData.systemPrompt || agent.systemMessage || ''),
           modelPreferences: updateData.modelPreferences || agent.configuration?.modelPreferences
         },
         orchestrator: {
           type: 'orchestrator',
           systemPrompt: generateAgentSpecificPrompt(AgentType.ORCHESTRATOR, (updateData.personality || agent.personalityType) as string, updateData.systemPrompt || agent.systemMessage || ''),
           modelPreferences: updateData.modelPreferences || agent.configuration?.modelPreferences
         }
       }
    };

    const updatedAgent = await agentRepository.save(agent);
    
    logger.info(`✅ Updated agent ${agentId} configuration`);

    // **TRIGGER TWITTER LEARNING AUTOMATICALLY**
    logger.info(`🧠 Triggering Twitter learning for updated agent ${agentId}...`);
    try {
      await twitterLearningService.processUserTwitterData(user);
      logger.info(`✅ Twitter learning completed for updated agent ${agentId}`);
    } catch (learningError) {
      logger.error(`⚠️ Twitter learning failed for updated agent ${agentId}:`, learningError);
      // Don't fail agent update if learning fails
    }

    // Transform response
    const responseAgent = {
      id: updatedAgent.id.toString(),
      name: updatedAgent.agentName,
      personality: updatedAgent.personalityType,
      level: updatedAgent.performanceMetrics?.level || 1,
      experience: updatedAgent.performanceMetrics?.experience || 0,
      maxExperience: 100,
      quality: updatedAgent.performanceMetrics?.qualityScore || 0,
      alignment: updatedAgent.performanceMetrics?.alignment || 50,
      learning: updatedAgent.performanceMetrics?.learningProgress || 0,
      status: 'ready',
      deploys: updatedAgent.performanceMetrics?.totalDeployments || 0,
      x_account_connected: !!user.twitterHandle,
      system_message: updatedAgent.systemMessage || '',
      config: updatedAgent.configuration || {},
      agentType: 'personalized_agent',
      updatedAt: updatedAgent.updatedAt
    };

    logger.info(`🎉 Successfully updated agent ${agentId} and triggered learning`);

    return res.json({
      success: true,
      message: 'Agent configuration updated successfully',
      data: responseAgent,
      learningTriggered: true
    });

  } catch (error) {
    logger.error(`❌ Error updating agent ${req.params.agentId}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update agent configuration',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /agents/update/:walletAddress
 * Update agent configuration for a user (legacy)
 */
router.put('/update/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const updateData: UpdateAgentRequest = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required'
      });
    }
    
    logger.info(`🔄 Updating agent configuration for wallet: ${walletAddress}`);

    // Find user
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Get all agent configurations for this user
    const agentRepository = AppDataSource.getRepository(AgentConfiguration);
    const agents = await agentRepository.find({
      where: { userId: user.id, isActive: true }
    });

    if (agents.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No agents found for this user'
      });
    }

    // Update all agents with new configuration
    const updatedAgents = [];
    for (const agent of agents) {
      // Merge existing configuration with updates
      agent.configuration = {
        ...agent.configuration,
        ...updateData,
        updatedAt: new Date().toISOString()
      };

      // Update system prompt for each agent type if provided
      if (updateData.systemPrompt) {
        agent.configuration.systemPrompt = generateAgentSpecificPrompt(
          agent.agentType,
          updateData.personality || agent.configuration.personality,
          updateData.systemPrompt
        );
      }

      const updatedAgent = await agentRepository.save(agent);
      updatedAgents.push(updatedAgent);
      
      logger.info(`✅ Updated ${agent.agentType} agent for user ${user.id}`);
    }

    // Transform response
    const responseAgents = updatedAgents.map(agent => ({
      id: agent.id.toString(),
      name: agent.configuration?.name || `Agent ${agent.agentType}`,
      personality: agent.configuration?.personality || 'WITTY',
      level: agent.performanceMetrics?.level || 1,
      experience: agent.performanceMetrics?.experience || 0,
      maxExperience: 100,
      quality: agent.performanceMetrics?.qualityScore || 0,
      alignment: agent.performanceMetrics?.alignment || 50,
      learning: agent.performanceMetrics?.learningProgress || 0,
      status: 'ready',
      deploys: agent.performanceMetrics?.totalDeployments || 0,
      x_account_connected: !!user.twitterHandle,
      system_message: agent.configuration?.systemPrompt || '',
      config: agent.configuration || {},
      agentType: agent.agentType,
      updatedAt: agent.updatedAt
    }));

    logger.info(`✅ Successfully updated ${updatedAgents.length} agents for user ${user.id}`);

    return res.json({
      success: true,
      message: 'Agent configuration updated successfully',
      data: responseAgents
    });

  } catch (error) {
    logger.error('❌ Error updating agent configuration:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update agent configuration',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Generate agent-specific system prompts based on agent type and personality
 */
function generateAgentSpecificPrompt(agentType: AgentType, personality: string, basePrompt: string): string {
  const personalityTraits = {
    WITTY: 'clever, sharp, and intellectually humorous',
    SAVAGE: 'bold, direct, and brutally honest', 
    CHAOTIC: 'unpredictable, creative, and spontaneous',
    LEGENDARY: 'wise, authoritative, and memorable'
  };

  const agentRoles = {
    [AgentType.DATA_ANALYST]: 'You are a Data Analyst Agent. Analyze engagement patterns, optimal posting times, and content performance metrics.',
    [AgentType.CONTENT_STRATEGIST]: 'You are a Content Strategist Agent. Plan content themes, messaging strategies, and audience engagement approaches.',
    [AgentType.TEXT_CONTENT]: 'You are a Text Content Agent. Generate written content that matches the user\'s authentic voice and style.',
    [AgentType.VISUAL_CREATOR]: 'You are a Visual Creator Agent. Design and suggest visual content to complement text posts.',
    [AgentType.ORCHESTRATOR]: 'You are an Orchestrator Agent. Coordinate the work of all agents and ensure content quality and consistency.'
  };

  return `${agentRoles[agentType]} Your personality is ${personalityTraits[personality as keyof typeof personalityTraits] || 'professional'}. 

${basePrompt}

Remember to:
- Stay true to the user's learned behavior patterns
- Maintain the ${personality} personality in all outputs
- Collaborate effectively with other agents in the constellation
- Continuously learn and adapt from user feedback`;
}

export default router; 