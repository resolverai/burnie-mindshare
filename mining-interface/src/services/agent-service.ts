import { ContentGenerationRequest, ContentGenerationResponse } from './ai-providers';

export interface AgentPersonality {
  type: 'SAVAGE' | 'WITTY' | 'CHAOTIC' | 'LEGENDARY';
  traits: {
    aggression: number; // 0-1
    humor: number; // 0-1
    creativity: number; // 0-1
    authority: number; // 0-1
    unpredictability: number; // 0-1
  };
  vocabulary: string[];
  tonalModifiers: string[];
  preferredStructures: string[];
}

export interface AgentPerformanceMetrics {
  totalContentGenerated: number;
  averageQualityScore: number;
  averageBrandAlignment: number;
  totalTokensUsed: number;
  totalCostSpent: number;
  campaignsParticipated: number;
  winRate: number;
  learningProgress: number;
  improvementRate: number;
  lastPerformanceUpdate: Date;
}

export interface AgentLearningData {
  successfulPrompts: string[];
  failedPrompts: string[];
  highPerformingContent: ContentGenerationResponse[];
  brandAlignmentPatterns: Record<string, number>;
  optimalSettings: {
    temperature: number;
    maxTokens: number;
    preferredProviders: string[];
  };
  adaptationHistory: Array<{
    timestamp: Date;
    change: string;
    reason: string;
    impact: number;
  }>;
}

export interface MiningAgent {
  id: string;
  name: string;
  description: string;
  personality: AgentPersonality;
  performance: AgentPerformanceMetrics;
  learning: AgentLearningData;
  brandProfiles: Record<string, {
    alignment: number;
    keywords: string[];
    successfulPatterns: string[];
    preferredTone: string;
  }>;
  teamCompatibility: {
    preferredRoles: string[];
    collaborationHistory: Array<{
      teamId: string;
      role: string;
      performance: number;
    }>;
  };
  version: number;
  createdAt: Date;
  lastUpdated: Date;
  isActive: boolean;
}

export interface TeamFormation {
  id: string;
  name: string;
  agents: MiningAgent[];
  roles: Record<string, string>; // agentId -> role
  sharedResources: {
    apiKeys: Record<string, boolean>;
    specializations: string[];
    collectiveKnowledge: string[];
  };
  performance: {
    totalCampaigns: number;
    winRate: number;
    averageQuality: number;
    synergyScore: number;
  };
  strategy: string;
  createdAt: Date;
}

export class AgentService {
  private agents: Map<string, MiningAgent> = new Map();
  private teams: Map<string, TeamFormation> = new Map();
  private readonly STORAGE_KEY = 'roastpower_agents_v2';
  private readonly TEAMS_STORAGE_KEY = 'roastpower_teams_v2';

  constructor() {
    this.loadAgents();
    this.loadTeams();
  }

  // Agent Management
  public createAgent(
    name: string,
    description: string,
    personalityType: 'SAVAGE' | 'WITTY' | 'CHAOTIC' | 'LEGENDARY'
  ): MiningAgent {
    const id = this.generateAgentId();
    const personality = this.createPersonalityProfile(personalityType);
    
    const agent: MiningAgent = {
      id,
      name,
      description,
      personality,
      performance: this.initializePerformanceMetrics(),
      learning: this.initializeLearningData(),
      brandProfiles: {},
      teamCompatibility: {
        preferredRoles: this.getDefaultRoles(personalityType),
        collaborationHistory: []
      },
      version: 1,
      createdAt: new Date(),
      lastUpdated: new Date(),
      isActive: true
    };

    this.agents.set(id, agent);
    this.saveAgents();
    
    console.log(`🤖 Created agent: ${name} (${personalityType})`);
    return agent;
  }

  private createPersonalityProfile(type: 'SAVAGE' | 'WITTY' | 'CHAOTIC' | 'LEGENDARY'): AgentPersonality {
    const profiles = {
      'SAVAGE': {
        type: 'SAVAGE' as const,
        traits: {
          aggression: 0.9,
          humor: 0.3,
          creativity: 0.7,
          authority: 0.8,
          unpredictability: 0.6
        },
        vocabulary: ['demolish', 'destroy', 'obliterate', 'savage', 'brutal', 'ruthless', 'fierce'],
        tonalModifiers: ['No mercy', 'Cut through the noise', 'Raw truth', 'Uncompromising'],
        preferredStructures: ['Direct attack', 'Bold statement', 'Provocative hook', 'Challenge assumptions']
      },
      'WITTY': {
        type: 'WITTY' as const,
        traits: {
          aggression: 0.4,
          humor: 0.9,
          creativity: 0.8,
          authority: 0.7,
          unpredictability: 0.6
        },
        vocabulary: ['clever', 'brilliant', 'genius', 'witty', 'smart', 'insightful', 'sharp'],
        tonalModifiers: ['Plot twist', 'Fun fact', 'Breaking news', 'Pro tip'],
        preferredStructures: ['Setup and punchline', 'Unexpected twist', 'Clever observation', 'Playful analogy']
      },
      'CHAOTIC': {
        type: 'CHAOTIC' as const,
        traits: {
          aggression: 0.6,
          humor: 0.7,
          creativity: 0.95,
          authority: 0.5,
          unpredictability: 0.95
        },
        vocabulary: ['chaos', 'madness', 'wild', 'random', 'unpredictable', 'crazy', 'insane'],
        tonalModifiers: ['Chaos energy', 'Wild card', 'Random greatness', 'Beautiful madness'],
        preferredStructures: ['Stream of consciousness', 'Unexpected connections', 'Creative chaos', 'Rule breaking']
      },
      'LEGENDARY': {
        type: 'LEGENDARY' as const,
        traits: {
          aggression: 0.6,
          humor: 0.5,
          creativity: 0.8,
          authority: 0.95,
          unpredictability: 0.4
        },
        vocabulary: ['legendary', 'iconic', 'timeless', 'eternal', 'profound', 'wisdom', 'greatness'],
        tonalModifiers: ['Legendary status', 'Iconic moment', 'Timeless truth', 'Epic wisdom'],
        preferredStructures: ['Profound insight', 'Timeless wisdom', 'Authoritative statement', 'Legacy building']
      }
    };

    return profiles[type];
  }

  private initializePerformanceMetrics(): AgentPerformanceMetrics {
    return {
      totalContentGenerated: 0,
      averageQualityScore: 0,
      averageBrandAlignment: 0,
      totalTokensUsed: 0,
      totalCostSpent: 0,
      campaignsParticipated: 0,
      winRate: 0,
      learningProgress: 0,
      improvementRate: 0,
      lastPerformanceUpdate: new Date()
    };
  }

  private initializeLearningData(): AgentLearningData {
    return {
      successfulPrompts: [],
      failedPrompts: [],
      highPerformingContent: [],
      brandAlignmentPatterns: {},
      optimalSettings: {
        temperature: 0.7,
        maxTokens: 500,
        preferredProviders: ['openai', 'anthropic']
      },
      adaptationHistory: []
    };
  }

  private getDefaultRoles(personalityType: string): string[] {
    const roleMap = {
      'SAVAGE': ['Disruptor', 'Challenger', 'Truth Teller', 'Edge Content Creator'],
      'WITTY': ['Content Optimizer', 'Engagement Specialist', 'Community Manager', 'Viral Creator'],
      'CHAOTIC': ['Creative Director', 'Innovation Lead', 'Experimental Creator', 'Trend Setter'],
      'LEGENDARY': ['Strategic Lead', 'Authority Builder', 'Long-form Creator', 'Thought Leader']
    };
    return roleMap[personalityType] || ['General Creator'];
  }

  // Learning and Adaptation
  public updateAgentPerformance(
    agentId: string,
    contentResponse: ContentGenerationResponse,
    campaignData?: { id: number; brandContext?: string }
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Update performance metrics
    agent.performance.totalContentGenerated++;
    agent.performance.totalTokensUsed += contentResponse.metadata.tokensUsed || 0;
    agent.performance.totalCostSpent += contentResponse.metadata.cost || 0;

    // Update quality scores
    if (contentResponse.metadata.qualityScore) {
      const newAvg = (agent.performance.averageQualityScore * (agent.performance.totalContentGenerated - 1) + 
                     contentResponse.metadata.qualityScore) / agent.performance.totalContentGenerated;
      agent.performance.averageQualityScore = newAvg;
    }

    // Update brand alignment
    if (contentResponse.metadata.brandAlignmentScore) {
      const newAvg = (agent.performance.averageBrandAlignment * (agent.performance.totalContentGenerated - 1) + 
                     contentResponse.metadata.brandAlignmentScore) / agent.performance.totalContentGenerated;
      agent.performance.averageBrandAlignment = newAvg;
    }

    // Learning adaptation
    if (contentResponse.metadata.qualityScore && contentResponse.metadata.qualityScore > 0.8) {
      agent.learning.highPerformingContent.push(contentResponse);
      
      // Keep only top 50 high-performing content pieces
      if (agent.learning.highPerformingContent.length > 50) {
        agent.learning.highPerformingContent.sort((a, b) => 
          (b.metadata.qualityScore || 0) - (a.metadata.qualityScore || 0)
        );
        agent.learning.highPerformingContent = agent.learning.highPerformingContent.slice(0, 50);
      }
    }

    // Brand profile learning
    if (campaignData?.brandContext && contentResponse.metadata.brandAlignmentScore) {
      const brandKey = this.generateBrandKey(campaignData.brandContext);
      if (!agent.brandProfiles[brandKey]) {
        agent.brandProfiles[brandKey] = {
          alignment: 0,
          keywords: [],
          successfulPatterns: [],
          preferredTone: agent.personality.type.toLowerCase()
        };
      }
      
      const profile = agent.brandProfiles[brandKey];
      profile.alignment = (profile.alignment + contentResponse.metadata.brandAlignmentScore) / 2;
      
      // Extract keywords from brand context
      const keywords = campaignData.brandContext.toLowerCase().split(/\s+/);
      keywords.forEach(keyword => {
        if (!profile.keywords.includes(keyword)) {
          profile.keywords.push(keyword);
        }
      });
    }

    agent.performance.lastPerformanceUpdate = new Date();
    agent.lastUpdated = new Date();
    agent.version++;

    this.saveAgents();
  }

  public adaptAgentSettings(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const metrics = agent.performance;
    const learning = agent.learning;

    // Adapt temperature based on quality scores
    if (metrics.averageQualityScore > 0.8) {
      learning.optimalSettings.temperature = Math.max(0.3, learning.optimalSettings.temperature - 0.1);
    } else if (metrics.averageQualityScore < 0.6) {
      learning.optimalSettings.temperature = Math.min(0.9, learning.optimalSettings.temperature + 0.1);
    }

    // Adapt max tokens based on performance
    if (metrics.averageQualityScore > 0.7 && metrics.averageBrandAlignment > 0.7) {
      learning.optimalSettings.maxTokens = Math.min(800, learning.optimalSettings.maxTokens + 50);
    }

    // Calculate learning progress
    const totalInteractions = metrics.totalContentGenerated;
    agent.performance.learningProgress = Math.min(1.0, totalInteractions / 100); // Max learning at 100 interactions

    // Record adaptation
    learning.adaptationHistory.push({
      timestamp: new Date(),
      change: `Adjusted temperature to ${learning.optimalSettings.temperature}, maxTokens to ${learning.optimalSettings.maxTokens}`,
      reason: `Quality: ${metrics.averageQualityScore.toFixed(2)}, Brand: ${metrics.averageBrandAlignment.toFixed(2)}`,
      impact: 0.1
    });

    // Keep only last 20 adaptations
    if (learning.adaptationHistory.length > 20) {
      learning.adaptationHistory = learning.adaptationHistory.slice(-20);
    }

    agent.lastUpdated = new Date();
    this.saveAgents();
  }

  // Team Formation and Collaboration
  public createTeam(name: string, agentIds: string[], strategy: string = 'balanced'): TeamFormation | null {
    const agents = agentIds.map(id => this.agents.get(id)).filter(Boolean) as MiningAgent[];
    
    if (agents.length === 0) {
      console.error('No valid agents found for team creation');
      return null;
    }

    const teamId = this.generateTeamId();
    const roles = this.assignOptimalRoles(agents, strategy);

    const team: TeamFormation = {
      id: teamId,
      name,
      agents,
      roles,
      sharedResources: {
        apiKeys: {},
        specializations: this.combineSpecializations(agents),
        collectiveKnowledge: this.combineKnowledge(agents)
      },
      performance: {
        totalCampaigns: 0,
        winRate: 0,
        averageQuality: 0,
        synergyScore: this.calculateSynergy(agents)
      },
      strategy,
      createdAt: new Date()
    };

    this.teams.set(teamId, team);
    this.saveTeams();

    console.log(`👥 Created team: ${name} with ${agents.length} agents`);
    return team;
  }

  private assignOptimalRoles(agents: MiningAgent[], strategy: string): Record<string, string> {
    const roles: Record<string, string> = {};

    if (strategy === 'balanced') {
      const availableRoles = ['Lead Creator', 'Quality Optimizer', 'Brand Specialist', 'Engagement Enhancer'];
      agents.forEach((agent, index) => {
        const role = availableRoles[index % availableRoles.length];
        roles[agent.id] = role;
      });
    } else if (strategy === 'specialized') {
      agents.forEach(agent => {
        const bestRole = agent.teamCompatibility.preferredRoles[0] || 'Creator';
        roles[agent.id] = bestRole;
      });
    }

    return roles;
  }

  private combineSpecializations(agents: MiningAgent[]): string[] {
    const specializations = new Set<string>();
    agents.forEach(agent => {
      agent.personality.vocabulary.forEach(word => specializations.add(word));
      agent.personality.preferredStructures.forEach(structure => specializations.add(structure));
    });
    return Array.from(specializations);
  }

  private combineKnowledge(agents: MiningAgent[]): string[] {
    const knowledge = new Set<string>();
    agents.forEach(agent => {
      agent.learning.successfulPrompts.slice(-10).forEach(prompt => knowledge.add(prompt));
      Object.keys(agent.brandProfiles).forEach(brand => knowledge.add(`Brand: ${brand}`));
    });
    return Array.from(knowledge);
  }

  private calculateSynergy(agents: MiningAgent[]): number {
    if (agents.length < 2) return 1.0;

    // Calculate personality diversity
    const personalities = agents.map(a => a.personality.type);
    const uniquePersonalities = new Set(personalities);
    const diversityScore = uniquePersonalities.size / personalities.length;

    // Calculate complementary traits
    const avgAggression = agents.reduce((sum, a) => sum + a.personality.traits.aggression, 0) / agents.length;
    const avgHumor = agents.reduce((sum, a) => sum + a.personality.traits.humor, 0) / agents.length;
    const avgCreativity = agents.reduce((sum, a) => sum + a.personality.traits.creativity, 0) / agents.length;

    // Balanced teams have higher synergy
    const balanceScore = 1 - Math.abs(0.7 - avgAggression) - Math.abs(0.7 - avgHumor) - Math.abs(0.8 - avgCreativity);

    return Math.max(0.1, Math.min(1.0, (diversityScore + balanceScore) / 2));
  }

  // Enhanced Content Generation with Agent Learning
  public generateEnhancedPrompt(
    agent: MiningAgent,
    basePrompt: string,
    campaignContext?: { brandContext?: string; targetAudience?: string }
  ): ContentGenerationRequest {
    let enhancedPrompt = basePrompt;

    // Apply personality-specific enhancements
    const personality = agent.personality;
    const randomModifier = personality.tonalModifiers[Math.floor(Math.random() * personality.tonalModifiers.length)];
    const randomStructure = personality.preferredStructures[Math.floor(Math.random() * personality.preferredStructures.length)];

    enhancedPrompt = `${randomModifier}: ${enhancedPrompt}\n\nStructure: ${randomStructure}`;

    // Apply learned brand patterns
    if (campaignContext?.brandContext) {
      const brandKey = this.generateBrandKey(campaignContext.brandContext);
      const brandProfile = agent.brandProfiles[brandKey];
      
      if (brandProfile && brandProfile.alignment > 0.6) {
        enhancedPrompt += `\n\nBrand alignment patterns: ${brandProfile.successfulPatterns.slice(0, 3).join(', ')}`;
      }
    }

    // Add vocabulary richness
    const vocabulary = personality.vocabulary.slice(0, 3).join(', ');
    enhancedPrompt += `\n\nPersonality vocabulary: ${vocabulary}`;

    return {
      prompt: enhancedPrompt,
      contentType: 'text',
      agentPersonality: personality.type,
      brandAlignment: campaignContext?.brandContext,
      targetAudience: campaignContext?.targetAudience,
      options: {
        temperature: agent.learning.optimalSettings.temperature,
        maxTokens: agent.learning.optimalSettings.maxTokens
      }
    };
  }

  // Utility Methods
  private generateAgentId(): string {
    return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateTeamId(): string {
    return `team_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateBrandKey(brandContext: string): string {
    return brandContext.toLowerCase().replace(/\s+/g, '_').substring(0, 50);
  }

  // Storage Management
  private saveAgents(): void {
    try {
      const agentsArray = Array.from(this.agents.entries());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(agentsArray));
    } catch (error) {
      console.error('Failed to save agents:', error);
    }
  }

  private loadAgents(): void {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const agentsArray = JSON.parse(saved);
        this.agents = new Map(agentsArray.map(([id, agent]: [string, any]) => [
          id,
          {
            ...agent,
            createdAt: new Date(agent.createdAt),
            lastUpdated: new Date(agent.lastUpdated),
            performance: {
              ...agent.performance,
              lastPerformanceUpdate: new Date(agent.performance.lastPerformanceUpdate)
            },
            learning: {
              ...agent.learning,
              adaptationHistory: agent.learning.adaptationHistory.map((h: any) => ({
                ...h,
                timestamp: new Date(h.timestamp)
              }))
            }
          }
        ]));
      }
    } catch (error) {
      console.error('Failed to load agents:', error);
    }
  }

  private saveTeams(): void {
    try {
      const teamsArray = Array.from(this.teams.entries());
      localStorage.setItem(this.TEAMS_STORAGE_KEY, JSON.stringify(teamsArray));
    } catch (error) {
      console.error('Failed to save teams:', error);
    }
  }

  private loadTeams(): void {
    try {
      const saved = localStorage.getItem(this.TEAMS_STORAGE_KEY);
      if (saved) {
        const teamsArray = JSON.parse(saved);
        this.teams = new Map(teamsArray.map(([id, team]: [string, any]) => [
          id,
          {
            ...team,
            createdAt: new Date(team.createdAt)
          }
        ]));
      }
    } catch (error) {
      console.error('Failed to load teams:', error);
    }
  }

  // Public API
  public getAgent(id: string): MiningAgent | undefined {
    return this.agents.get(id);
  }

  public getAllAgents(): MiningAgent[] {
    return Array.from(this.agents.values());
  }

  public getActiveAgents(): MiningAgent[] {
    return this.getAllAgents().filter(agent => agent.isActive);
  }

  public getTeam(id: string): TeamFormation | undefined {
    return this.teams.get(id);
  }

  public getAllTeams(): TeamFormation[] {
    return Array.from(this.teams.values());
  }

  public deleteAgent(id: string): boolean {
    const deleted = this.agents.delete(id);
    if (deleted) {
      this.saveAgents();
    }
    return deleted;
  }

  public deleteTeam(id: string): boolean {
    const deleted = this.teams.delete(id);
    if (deleted) {
      this.saveTeams();
    }
    return deleted;
  }

  public updateAgent(id: string, updates: Partial<MiningAgent>): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;

    Object.assign(agent, updates, { lastUpdated: new Date(), version: agent.version + 1 });
    this.saveAgents();
    return true;
  }

  public getAgentInsights(id: string): any {
    const agent = this.agents.get(id);
    if (!agent) return null;

    return {
      personalityStrength: this.calculatePersonalityStrength(agent),
      learningVelocity: this.calculateLearningVelocity(agent),
      brandAffinities: this.getBrandAffinities(agent),
      improvementAreas: this.getImprovementAreas(agent),
      teamCompatibility: this.getTeamCompatibilityScore(agent)
    };
  }

  private calculatePersonalityStrength(agent: MiningAgent): number {
    const traits = agent.personality.traits;
    const dominantTrait = Math.max(...Object.values(traits));
    return dominantTrait;
  }

  private calculateLearningVelocity(agent: MiningAgent): number {
    const recentAdaptations = agent.learning.adaptationHistory.slice(-5);
    return recentAdaptations.reduce((sum, adapt) => sum + adapt.impact, 0) / 5;
  }

  private getBrandAffinities(agent: MiningAgent): Array<{brand: string, alignment: number}> {
    return Object.entries(agent.brandProfiles)
      .map(([brand, profile]) => ({ brand, alignment: profile.alignment }))
      .sort((a, b) => b.alignment - a.alignment)
      .slice(0, 5);
  }

  private getImprovementAreas(agent: MiningAgent): string[] {
    const areas = [];
    if (agent.performance.averageQualityScore < 0.7) areas.push('Content Quality');
    if (agent.performance.averageBrandAlignment < 0.6) areas.push('Brand Alignment');
    if (agent.performance.winRate < 0.3) areas.push('Competitive Performance');
    return areas;
  }

  private getTeamCompatibilityScore(agent: MiningAgent): number {
    const collaborations = agent.teamCompatibility.collaborationHistory;
    if (collaborations.length === 0) return 0.5; // Default neutral score
    
    const avgPerformance = collaborations.reduce((sum, collab) => sum + collab.performance, 0) / collaborations.length;
    return avgPerformance;
  }
}

// Export singleton instance
export const agentService = new AgentService(); 