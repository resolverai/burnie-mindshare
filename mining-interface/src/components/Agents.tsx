import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { 
  PlusIcon, BeakerIcon, CpuChipIcon, AcademicCapIcon,
  ArrowPathIcon, SparklesIcon, FireIcon, PencilIcon, LinkIcon,
  PowerIcon
} from '@heroicons/react/24/outline'
import { CreateAgentModal } from './CreateAgentModal'

interface PersonalizedAgent {
  id: string
  name: string
  personality: 'WITTY' | 'SAVAGE' | 'CHAOTIC' | 'LEGENDARY'
  level: number
  experience: number
  maxExperience: number
  quality: number
  alignment: number
  learning: number
  status: 'ready' | 'training' | 'offline'
  deploys: number
  x_account_connected: boolean
  system_message: string
  config: any

  agentType?: string;
  createdAt?: string;
  lastUpdated?: string;
  isActive?: boolean;
}

function Agents() {
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [editingAgent, setEditingAgent] = useState<PersonalizedAgent | null>(null)
  const [isReconnectingTwitter, setIsReconnectingTwitter] = useState(false)
  const [twitterConnectionError, setTwitterConnectionError] = useState(false)
  const { address } = useAccount()
  const queryClient = useQueryClient()

  // Check if we're in dedicated miner mode
  const isDedicatedMiner = process.env.NEXT_PUBLIC_MINER === '1'

  // Fetch real user agents from backend
  const { data: agents = [], isLoading: agentsLoading, error } = useQuery({
    queryKey: ['user-agents', address],
    queryFn: async () => {
      if (!address) return []
      
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/agents/user/${address}`)
        if (response.ok) {
          const data = await response.json()
          return data.data || []
        }
        return []
      } catch (error) {
        console.error('Error fetching user agents:', error)
        return []
      }
    },
    enabled: !!address,
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  // Mutation to update learning for a specific agent
  const updateAgentLearningMutation = useMutation({
    mutationFn: async (agentId: string) => {
      if (!address) throw new Error('No wallet connected')
      
      // Helper function to attempt token refresh
      const attemptTokenRefresh = async () => {
        try {
          const refreshResponse = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/twitter-auth/refresh-token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              wallet_address: address
            })
          });
          
          if (refreshResponse.ok) {
            console.log('✅ Token refreshed successfully');
            return true;
          } else {
            const errorData = await refreshResponse.json();
            if (errorData.requires_reconnection) {
              throw new Error('Twitter connection expired. Please reconnect your Twitter account in the Agents screen.');
            }
            throw new Error(errorData.error || 'Failed to refresh token');
          }
        } catch (error) {
          console.error('❌ Token refresh failed:', error);
          throw error;
        }
      };
      
      // Main API call function
      const makeUpdateRequest = async () => {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/agents/${agentId}/update-learning`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        return response;
      };
      
      // First attempt
      let response = await makeUpdateRequest();
      
      // If 401 Unauthorized, attempt token refresh and retry
      if (response.status === 401) {
        console.warn('🔑 Access token expired, attempting refresh...');
        
        try {
          await attemptTokenRefresh();
          console.log('🔄 Token refreshed, retrying learning update...');
          
          // Retry the request
          response = await makeUpdateRequest();
        } catch (refreshError) {
          // If refresh fails, throw the refresh error instead of the original 401
          throw refreshError;
        }
      }
      
      if (!response.ok) {
        const errorData = await response.json()
        
        // Check if it's a Twitter connection issue
        if (errorData.error?.includes('Twitter data') || errorData.details?.includes('Twitter API')) {
          throw new Error('Twitter connection issue. Please check your Twitter connection and try again.')
        }
        
        throw new Error(errorData.error || 'Failed to update learning')
      }
      
      return response.json()
    },
    onSuccess: () => {
      // Refetch agents data after learning update
      queryClient.invalidateQueries({ queryKey: ['user-agents', address] })
      queryClient.invalidateQueries({ queryKey: ['all-agents-learning-status', address] })
      queryClient.invalidateQueries({ queryKey: ['agent-analytics', address] })
      // Clear any Twitter connection errors on success
      setTwitterConnectionError(false)
    },
    onError: (error: Error) => {
      // Check if this is a Twitter connection error
      if (error.message.includes('Twitter connection') || 
          error.message.includes('Twitter API') || 
          error.message.includes('Unauthorized') ||
          error.message.includes('expired')) {
        setTwitterConnectionError(true)
      }
      
      // Also invalidate learning status on error to refresh Twitter connection status
      queryClient.invalidateQueries({ queryKey: ['all-agents-learning-status', address] })
      console.error('Learning update failed:', error.message)
    }
  })

  // Get learning status for all agents (only for regular miners)
  const agentLearningStatuses = useQuery({
    queryKey: ['all-agents-learning-status', address, agents.map(a => a.id)],
    queryFn: async () => {
      if (!address || agents.length === 0 || isDedicatedMiner) return {}
      
      const statusPromises = agents.map(async (agent) => {
        try {
          const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/agents/${agent.id}/learning-status`)
          if (response.ok) {
            const data = await response.json()
            return { [agent.id]: data.data }
          }
          return { [agent.id]: null }
        } catch (error) {
          console.error(`Error fetching learning status for agent ${agent.id}:`, error)
          return { [agent.id]: null }
        }
      })
      
      const results = await Promise.all(statusPromises)
      return results.reduce((acc, curr) => ({ ...acc, ...curr }), {})
    },
    enabled: !!address && agents.length > 0 && !agentsLoading && !isDedicatedMiner,
  })

  // Fetch agent performance analytics for quality and deploys calculation
  const { data: agentAnalytics = [] } = useQuery({
    queryKey: ['agent-analytics', address],
    queryFn: async () => {
      if (!address) return []
      
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/marketplace/analytics/agent-performance/${address}`)
        if (response.ok) {
          const data = await response.json()
          return data.data || []
        }
        return []
      } catch (error) {
        console.error('Error fetching agent analytics:', error)
        return []
      }
    },
    enabled: !!address,
    refetchInterval: 60000, // Refetch every minute
  })

  // Twitter re-connection mutation
  const twitterReconnectMutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('No wallet connected')
      
      setIsReconnectingTwitter(true)
      
      // Step 1: Get Twitter OAuth URL
      const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/twitter-auth/twitter/url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet_address: address,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get Twitter OAuth URL')
      }

      const data = await response.json()
      
      if (!data.success || !data.data.oauth_url) {
        throw new Error('Invalid OAuth URL response')
      }

      // Store state, code verifier, and wallet address for later use
      localStorage.setItem('twitter_oauth_state', data.data.state)
      localStorage.setItem('twitter_code_verifier', data.data.code_verifier)
      localStorage.setItem('twitter_wallet_address', address || '')

      // Step 2: Open Twitter OAuth in a new window
      const authWindow = window.open(
        data.data.oauth_url,
        'twitter-auth',
        'width=500,height=600,scrollbars=yes,resizable=yes'
      )

      if (!authWindow) {
        throw new Error('Failed to open authentication window. Please disable popup blocker.')
      }

      // Step 3: Listen for messages from callback window
      return new Promise<void>((resolve, reject) => {
        let messageReceived = false
        const handleMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) {
            return // Ignore messages from other origins
          }

          if (event.data.type === 'TWITTER_AUTH_SUCCESS') {
            messageReceived = true
            console.log('✅ Twitter re-connection successful')
            window.removeEventListener('message', handleMessage)
            clearInterval(checkForClose)
            setIsReconnectingTwitter(false)
            resolve()
          } else if (event.data.type === 'TWITTER_AUTH_ERROR') {
            messageReceived = true
            console.log('❌ Twitter re-connection failed:', event.data.error)
            window.removeEventListener('message', handleMessage)
            clearInterval(checkForClose)
            setIsReconnectingTwitter(false)
            reject(new Error(event.data.error || 'Twitter authentication failed'))
          }
        }

        window.addEventListener('message', handleMessage)

        // Check if window is closed manually (fallback)
        const checkForClose = setInterval(() => {
          if (authWindow?.closed) {
            clearInterval(checkForClose)
            window.removeEventListener('message', handleMessage)
            setIsReconnectingTwitter(false)
            
            if (!messageReceived) {
              reject(new Error('Authentication window was closed'))
            }
          }
        }, 1000)
      })
    },
    onSuccess: () => {
      // Refresh all queries after successful Twitter re-connection
      queryClient.invalidateQueries({ queryKey: ['user-agents', address] })
      queryClient.invalidateQueries({ queryKey: ['all-agents-learning-status', address] })
      queryClient.invalidateQueries({ queryKey: ['agent-analytics', address] })
      // Clear Twitter connection error state
      setTwitterConnectionError(false)
      console.log('✅ Twitter re-connection completed successfully')
    },
    onError: (error: Error) => {
      // Also refresh learning status on error to update connection state
      queryClient.invalidateQueries({ queryKey: ['all-agents-learning-status', address] })
      console.error('❌ Twitter re-connection failed:', error.message)
    }
  })

  // Agent activation/deactivation mutation
  const toggleAgentActiveMutation = useMutation({
    mutationFn: async ({ agentId, isActive }: { agentId: string; isActive: boolean }) => {
      if (!address) throw new Error('No wallet connected')
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/agents/${agentId}/toggle-active`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isActive,
          wallet_address: address,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to toggle agent status')
      }

      return response.json()
    },
    onSuccess: () => {
      // Refresh agent list after toggling status
      queryClient.invalidateQueries({ queryKey: ['user-agents', address] })
      console.log('✅ Agent status toggled successfully')
    },
    onError: (error: Error) => {
      console.error('❌ Failed to toggle agent status:', error.message)
    }
  })

  const handleCreateAgent = (agentData: any) => {
    setShowCreateAgent(false)
    setEditingAgent(null)
    // Agent creation will trigger automatic learning
    queryClient.invalidateQueries({ queryKey: ['user-agents', address] })
    queryClient.invalidateQueries({ queryKey: ['all-agents-learning-status', address] })
    queryClient.invalidateQueries({ queryKey: ['agent-analytics', address] })
  }

  const handleEditAgent = (agent: PersonalizedAgent) => {
    console.log('handleEditAgent called with agent:', agent)
    setEditingAgent(agent)
    setShowCreateAgent(true) // Reuse the same modal
    console.log('editingAgent state after setting:', agent)
  }

  const handleUpdateAgentLearning = (agentId: string) => {
    updateAgentLearningMutation.mutate(agentId)
  }

  const handleTwitterReconnect = () => {
    twitterReconnectMutation.mutate()
  }

  const handleToggleAgentActive = (agentId: string, currentStatus: boolean) => {
    toggleAgentActiveMutation.mutate({ 
      agentId, 
      isActive: !currentStatus 
    })
  }

  // Helper function to get agent analytics data for a specific agent
  const getAgentAnalytics = (agentName: string) => {
    return agentAnalytics.find(analytics => analytics.agentName === agentName) || {
      agentName,
      contentCount: 0,
      bidCount: 0,
      revenue: 0,
      avgQuality: 0
    }
  }

  // Helper function to calculate quality percentage using same logic as Dashboard
  const calculateQualityPercentage = (agentName: string) => {
    const analytics = getAgentAnalytics(agentName)
    return Math.round(analytics.avgQuality) || 0
  }

  // Helper function to calculate deploys (number of content generated)
  const calculateDeploys = (agentName: string) => {
    const analytics = getAgentAnalytics(agentName)
    return analytics.contentCount || 0
  }

  // Helper function to calculate experience using weighted formula
  const calculateExperience = (agent: PersonalizedAgent) => {
    const learningProgress = agentLearningStatuses.data?.[agent.id]?.progress || agent.learning || 0
    const qualityPercentage = calculateQualityPercentage(agent.name)
    const deploys = calculateDeploys(agent.name)
    
    // Normalize deploys to a percentage (assuming max 50 deploys = 100%)
    const deploysPercentage = Math.min((deploys / 50) * 100, 100)
    
    // Weighted formula: 0.6 * learning% + 0.3 * deploys% + 0.1 * quality%
    const experience = Math.round(
      (learningProgress * 0.6) + 
      (deploysPercentage * 0.3) + 
      (qualityPercentage * 0.1)
    )
    
    return Math.min(experience, 100) // Cap at 100
  }

  if (agentsLoading) {
  return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ArrowPathIcon className="w-12 h-12 animate-spin text-orange-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading your neural agents...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-400 mb-4">Error loading agents</p>
          <button 
            onClick={() => queryClient.invalidateQueries({ queryKey: ['user-agents', address] })}
            className="btn-primary"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Neural Agents</h2>
          <p className="text-gray-400 mt-1">
            {isDedicatedMiner 
              ? "Your personalized AI agents for automated content generation"
              : "Your personalized AI agents trained on your Twitter behavior"
            }
          </p>
        </div>
        
        <button
          onClick={() => setShowCreateAgent(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white rounded-lg transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          <span>Create New Agent</span>
        </button>
      </div>

      {agents.length === 0 ? (
        // No agents - show creation interface
        <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-8 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-orange-500/20 to-red-600/20 rounded-xl flex items-center justify-center mx-auto mb-6">
            <CpuChipIcon className="w-10 h-10 text-orange-500" />
          </div>
          
          <h3 className="text-xl font-bold text-white mb-3">Create Your Personalized AI Agent</h3>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            {isDedicatedMiner 
              ? "Deploy a personalized AI agent configured with your preferred settings for automated content generation."
              : "Deploy a personalized AI agent that learns from your Twitter behavior to create content that matches your unique voice and style."
            }
          </p>
          
          <button
            onClick={() => setShowCreateAgent(true)}
            className="inline-flex items-center space-x-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200"
          >
            <PlusIcon className="w-5 h-5" />
            <span>Create Personalized Agent</span>
          </button>
        </div>
      ) : (
        // Show all agents as individual cards
        <div className="space-y-6">
          <div className="grid gap-6">
            {agents.map((agent: PersonalizedAgent) => {
              // Get learning status for this specific agent
              const agentLearningStatus = agentLearningStatuses.data?.[agent.id]
              
              return (
                <div 
                  key={agent.id} 
                  className={`bg-gradient-to-br from-gray-800/60 to-gray-900/60 backdrop-blur-sm border rounded-xl p-6 ${
                    agent.isActive === false 
                      ? 'border-gray-700/30 opacity-60' 
                      : 'border-gray-700/50'
                  }`}
                >
                  {/* Deactivated Agent Banner */}
                  {agent.isActive === false && (
                    <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
                      <div className="flex items-center space-x-2 text-yellow-400">
                        <PowerIcon className="w-5 h-5" />
                        <p className="text-sm font-medium">
                          Agent Deactivated - This agent will not be used for content generation
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {/* Per-Agent Learning Status - Only show for regular miners */}
                  {!isDedicatedMiner && agentLearningStatus && (
                    <div className="mb-4 p-3 bg-gray-800/40 rounded-lg border border-gray-700/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className={`w-3 h-3 rounded-full ${
                            agentLearningStatus.twitterConnected ? 'bg-green-500' : 'bg-yellow-500'
                          }`}></div>
                          <div>
                            <h4 className="text-white font-medium text-sm">Learning Status</h4>
                            <p className="text-gray-400 text-xs">
                              {agentLearningStatus.message}
                            </p>
                            {agentLearningStatus.learningProgress > 0 && (
                              <div className="mt-2">
                                <div className="flex justify-between text-xs text-gray-400 mb-1">
                                  <span>Progress</span>
                                  <span>{agentLearningStatus.learningProgress}%</span>
                                </div>
                                <div className="w-full bg-gray-700 rounded-full h-1.5">
                                  <div 
                                    className="bg-gradient-to-r from-blue-500 to-green-500 h-1.5 rounded-full transition-all duration-300"
                                    style={{ width: `${agentLearningStatus.learningProgress}%` }}
                                  ></div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        {agentLearningStatus.lastUpdated && (
                          <p className="text-gray-500 text-xs">
                            {new Date(agentLearningStatus.lastUpdated).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-4">
                      <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center">
                        <CpuChipIcon className="w-8 h-8 text-white" />
                      </div>
                      
                      <div>
                        <h3 className="text-xl font-bold text-white">{agent.name}</h3>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            agent.personality === 'SAVAGE' ? 'bg-red-500/20 text-red-400' :
                            agent.personality === 'WITTY' ? 'bg-blue-500/20 text-blue-400' :
                            agent.personality === 'CHAOTIC' ? 'bg-purple-500/20 text-purple-400' :
                            'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {agent.personality}
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            agent.status === 'ready' ? 'bg-green-500/20 text-green-400' :
                            agent.status === 'training' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>
                            {agent.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-3">
                      {/* Twitter connection status - Only show for regular miners */}
                      {!isDedicatedMiner && (
                        <div className="flex items-center space-x-2 text-sm text-gray-400">
                          {agent.x_account_connected ? (
                            <div className="flex items-center space-x-1 text-green-400">
                              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                              <span>Twitter Connected</span>
                            </div>
                          ) : (
                            <div className="flex items-center space-x-1 text-yellow-400">
                              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                              <span>No Twitter</span>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Agent Action Buttons */}
                      <div className="flex items-center space-x-2">
                        {/* Edit Agent Button */}
                        <button
                          onClick={() => handleEditAgent(agent)}
                          disabled={agent.isActive === false}
                          className="flex items-center space-x-2 px-3 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
                          title="Edit Agent"
                        >
                          <PencilIcon className="w-4 h-4" />
                          <span>Edit</span>
                        </button>
                        
                        {/* Activate/Deactivate Button */}
                        <button
                          onClick={() => handleToggleAgentActive(agent.id, agent.isActive !== false)}
                          disabled={toggleAgentActiveMutation.isPending}
                          className={`flex items-center space-x-2 px-3 py-2 text-white text-sm rounded-lg transition-colors ${
                            agent.isActive === false 
                              ? 'bg-green-600 hover:bg-green-700 disabled:bg-green-700' 
                              : 'bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-700'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={agent.isActive === false ? 'Activate Agent' : 'Deactivate Agent'}
                        >
                          {toggleAgentActiveMutation.isPending ? (
                            <ArrowPathIcon className="w-4 h-4 animate-spin" />
                          ) : (
                            <PowerIcon className="w-4 h-4" />
                          )}
                          <span>
                            {toggleAgentActiveMutation.isPending 
                              ? 'Processing...' 
                              : agent.isActive === false 
                                ? 'Activate' 
                                : 'Deactivate'}
                          </span>
                        </button>
                        
                        {/* Twitter Re-connect Button - Only show for regular miners */}
                        {!isDedicatedMiner && ((agentLearningStatus && !agentLearningStatus.twitterConnected) || twitterConnectionError) ? (
                          <button
                            onClick={handleTwitterReconnect}
                            disabled={isReconnectingTwitter || twitterReconnectMutation.isPending}
                            className="flex items-center space-x-2 px-3 py-2 bg-black hover:bg-gray-800 disabled:bg-gray-600 text-white text-sm rounded-lg transition-colors"
                            title="Re-connect Twitter Account"
                          >
                            {(isReconnectingTwitter || twitterReconnectMutation.isPending) ? (
                              <ArrowPathIcon className="w-4 h-4 animate-spin" />
                            ) : (
                              <LinkIcon className="w-4 h-4" />
                            )}
                            <span>
                              {(isReconnectingTwitter || twitterReconnectMutation.isPending) ? 'Connecting...' : 'Re-connect Twitter'}
                            </span>
                          </button>
                        ) : null}
                        
                        {/* Per-Agent Update Learning Button - Only show for regular miners */}
                        {!isDedicatedMiner && (
                          <button
                            onClick={() => handleUpdateAgentLearning(agent.id)}
                            disabled={updateAgentLearningMutation.isPending}
                            className="flex items-center space-x-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white text-sm rounded-lg transition-colors"
                          >
                            {updateAgentLearningMutation.isPending ? (
                              <ArrowPathIcon className="w-4 h-4 animate-spin" />
                            ) : (
                              <AcademicCapIcon className="w-4 h-4" />
                            )}
                            <span>{updateAgentLearningMutation.isPending ? 'Updating...' : 'Update Learning'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Stats */}
                  <div className={`grid ${isDedicatedMiner ? 'grid-cols-3' : 'grid-cols-4'} gap-4 mb-4`}>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-400">Lv.{agent.level}</div>
                      <div className="text-xs text-gray-400">Level</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-400">{calculateQualityPercentage(agent.name)}%</div>
                      <div className="text-xs text-gray-400">Quality</div>
                    </div>
                    {/* Learning stat - Only show for regular miners */}
                    {!isDedicatedMiner && (
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-400">{agentLearningStatuses.data?.[agent.id]?.progress || agent.learning || 0}%</div>
                        <div className="text-xs text-gray-400">Learning</div>
                      </div>
                    )}
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-400">{calculateDeploys(agent.name)}</div>
                      <div className="text-xs text-gray-400">Deploys</div>
                    </div>
                  </div>
                  
                  {/* Experience Bar */}
                  <div className="mb-4">
                    <div className="flex justify-between text-sm text-gray-400 mb-1">
                      <span>Experience</span>
                      <span>{calculateExperience(agent)}/100</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-orange-500 to-red-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${calculateExperience(agent)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Create/Edit Agent Modal */}
      {showCreateAgent && (
        <CreateAgentModal
          onClose={() => {
            setShowCreateAgent(false)
            setEditingAgent(null)
          }}
          onAgentCreated={handleCreateAgent}
          editingAgent={editingAgent}
        />
      )}
      
      {/* Loading/Error states for mutations - Only show for regular miners */}
      {!isDedicatedMiner && updateAgentLearningMutation.isError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-red-400">
            Failed to update learning: {updateAgentLearningMutation.error?.message}
          </p>
          </div>
        )}
      
      {!isDedicatedMiner && updateAgentLearningMutation.isSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <p className="text-green-400">
            ✅ Learning updated successfully! Your agent now has the latest insights from your Twitter.
          </p>
      </div>
      )}
      
      {/* Twitter Re-connection feedback - Only show for regular miners */}
      {!isDedicatedMiner && twitterReconnectMutation.isError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-red-400">
            Failed to re-connect Twitter: {twitterReconnectMutation.error?.message}
          </p>
        </div>
      )}
      
      {/* Twitter connection error with guidance - Only show for regular miners */}
      {!isDedicatedMiner && twitterConnectionError && !twitterReconnectMutation.isPending && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <p className="text-yellow-400">
            ⚠️ Twitter connection issue detected. Please click the "Re-connect Twitter" button to refresh your authentication.
          </p>
        </div>
      )}
      
      {!isDedicatedMiner && twitterReconnectMutation.isSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <p className="text-green-400">
            ✅ Twitter re-connected successfully! Your agent can now learn from your latest tweets.
          </p>
        </div>
      )}
    </div>
  )
} 

export default Agents 