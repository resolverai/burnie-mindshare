import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { 
  PlusIcon, BeakerIcon, CpuChipIcon, AcademicCapIcon,
  ArrowPathIcon, SparklesIcon, FireIcon, PencilIcon
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
}

function Agents() {
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [editingAgent, setEditingAgent] = useState<PersonalizedAgent | null>(null)
  const { address } = useAccount()
  const queryClient = useQueryClient()

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
      
              const response = await fetch(`${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/agents/${agentId}/update-learning`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update learning')
      }
      
      return response.json()
    },
    onSuccess: () => {
      // Refetch agents data after learning update
      queryClient.invalidateQueries({ queryKey: ['user-agents', address] })
      queryClient.invalidateQueries({ queryKey: ['all-agents-learning-status', address] })
    }
  })

  // Get learning status for all agents
  const agentLearningStatuses = useQuery({
    queryKey: ['all-agents-learning-status', address, agents.map(a => a.id)],
    queryFn: async () => {
      if (!address || agents.length === 0) return {}
      
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
    enabled: !!address && agents.length > 0 && !agentsLoading,
  })

  const handleCreateAgent = (agentData: any) => {
    setShowCreateAgent(false)
    setEditingAgent(null)
    // Agent creation will trigger automatic learning
    queryClient.invalidateQueries({ queryKey: ['user-agents', address] })
    queryClient.invalidateQueries({ queryKey: ['all-agents-learning-status', address] })
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
          <p className="text-gray-400 mt-1">Your personalized AI agents trained on your Twitter behavior</p>
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
            Deploy a personalized AI agent that learns from your Twitter behavior to create content that matches your unique voice and style.
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
                <div key={agent.id} className="bg-gradient-to-br from-gray-800/60 to-gray-900/60 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
                  {/* Per-Agent Learning Status */}
                  {agentLearningStatus && (
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
                      
                      {/* Agent Action Buttons */}
                      <div className="flex items-center space-x-2">
                        {/* Edit Agent Button */}
                        <button
                          onClick={() => handleEditAgent(agent)}
                          className="flex items-center space-x-2 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors"
                          title="Edit Agent"
                        >
                          <PencilIcon className="w-4 h-4" />
                          <span>Edit</span>
                        </button>
                        
                        {/* Per-Agent Update Learning Button */}
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
                      </div>
                    </div>
                  </div>
                  
                  {/* Stats */}
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-400">Lv.{agent.level}</div>
                      <div className="text-xs text-gray-400">Level</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-400">{agent.quality}%</div>
                      <div className="text-xs text-gray-400">Quality</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-400">{agent.learning}%</div>
                      <div className="text-xs text-gray-400">Learning</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-400">{agent.deploys}</div>
                      <div className="text-xs text-gray-400">Deploys</div>
                    </div>
                  </div>
                  
                  {/* Experience Bar */}
                  <div className="mb-4">
                    <div className="flex justify-between text-sm text-gray-400 mb-1">
                      <span>Experience</span>
                      <span>{agent.experience}/{agent.maxExperience}</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-orange-500 to-red-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(agent.experience / agent.maxExperience) * 100}%` }}
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
      
      {/* Loading/Error states for mutations */}
      {updateAgentLearningMutation.isError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-red-400">
            Failed to update learning: {updateAgentLearningMutation.error?.message}
          </p>
          </div>
        )}
      
      {updateAgentLearningMutation.isSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <p className="text-green-400">
            ✅ Learning updated successfully! Your agent now has the latest insights from your Twitter.
          </p>
      </div>
      )}
    </div>
  )
} 

export default Agents 