'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { 
  PlusIcon,
  MegaphoneIcon,
  CalendarDaysIcon,
  CurrencyDollarIcon,
  UsersIcon,
  ChartBarIcon,
  ArrowRightOnRectangleIcon,
  CpuChipIcon,
  ClockIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline'
import { FireIcon as FireIconSolid } from '@heroicons/react/24/solid'

interface AdminUser {
  id: number
  username: string
  last_login?: string
}

interface Campaign {
  id: string
  title: string
  description: string
  category: string
  rewardPool: string | number // bigint from database comes as string
  entryFee: string | number   // bigint from database comes as string
  maxSubmissions: string | number  // may come as string
  currentSubmissions: string | number // may come as string
  status: string
  campaignType: string
  platformSource?: string
  rewardToken?: string
  startDate?: string
  endDate?: string
  createdAt: string
  updatedAt: string
}

export default function AdminDashboard() {
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mlTraining, setMlTraining] = useState({
    isTraining: false,
    trainingId: '',
    progress: 0,
    message: '',
    showMLSection: false,
    trainingResults: null as any // Store detailed training results
  })
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    topic: '',
    guidelines: '',
    budget: '',
    reward_per_roast: '',
    max_submissions: '',
    end_date: ''
  })
  const router = useRouter()

  // Check admin authentication on mount
  useEffect(() => {
    const token = localStorage.getItem('adminToken')
    const user = localStorage.getItem('adminUser')
    
    if (!token || !user) {
      router.push('/admin')
      return
    }

    try {
      setAdminUser(JSON.parse(user))
    } catch (error) {
      router.push('/admin')
    }
  }, [router])

  // Get admin token for API calls
  const getAdminToken = () => {
    return localStorage.getItem('adminToken')
  }

  // Fetch campaigns
  const { data: campaigns, isLoading: campaignsLoading, refetch: refetchCampaigns } = useQuery({
    queryKey: ['admin-campaigns'],
    queryFn: async () => {
      const token = getAdminToken()
      if (!token) throw new Error('No admin token')

      const response = await fetch('http://localhost:3001/api/admin/campaigns', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch campaigns')
      }

      const data = await response.json()
      return data.data
    },
    enabled: !!adminUser,
    refetchInterval: 30000,
  })

  const handleLogout = () => {
    localStorage.removeItem('adminToken')
    localStorage.removeItem('adminUser')
    router.push('/admin')
  }

  // ML Training Functions
  const startMLTraining = async (algorithm = 'random_forest') => {
    try {
      setMlTraining(prev => ({ ...prev, isTraining: true, progress: 0, message: 'Starting training...' }))
      
      const response = await fetch('http://localhost:8000/admin/ml/train-models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          algorithm: algorithm,
          force_retrain: true
        })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setMlTraining(prev => ({ 
          ...prev, 
          trainingId: data.training_id,
          message: data.message
        }))
        
        // Poll for training status
        pollTrainingStatus(data.training_id)
      } else {
        throw new Error(data.message || 'Training failed to start')
      }
    } catch (error) {
      console.error('❌ ML Training failed:', error)
      setMlTraining(prev => ({ 
        ...prev, 
        isTraining: false, 
        message: `Training failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }))
    }
  }

  const pollTrainingStatus = async (trainingId: string) => {
    try {
      const response = await fetch(`http://localhost:8000/admin/ml/training-status/${trainingId}`)
      const data = await response.json()
      
      setMlTraining(prev => ({
        ...prev,
        progress: data.progress || 0,
        message: data.message || 'Training in progress...',
        trainingResults: data.summary // Store detailed results
      }))
      
      if (data.status === 'completed') {
        setMlTraining(prev => ({ 
          ...prev, 
          isTraining: false, 
          progress: 100,
          message: `Training completed! ${data.summary?.successful || 0}/${data.summary?.total_platforms || 0} models trained successfully.`,
          trainingResults: {
            ...data.summary,
            platforms: data.results, // Store detailed per-platform results
            total_models: Object.values(data.results || {}).reduce((acc: number, platform: any) => {
              if (platform.metadata?.algorithms) {
                return acc + platform.metadata.algorithms.length;
              }
              return acc;
            }, 0)
          }
        }))
      } else if (data.status === 'error') {
        setMlTraining(prev => ({ 
          ...prev, 
          isTraining: false, 
          message: `Training failed: ${data.error || 'Unknown error'}`
        }))
      } else if (data.status === 'training' || data.status === 'initializing') {
        // Continue polling
        setTimeout(() => pollTrainingStatus(trainingId), 3000)
      }
    } catch (error) {
      console.error('❌ Failed to poll training status:', error)
      setMlTraining(prev => ({ 
        ...prev, 
        isTraining: false, 
        message: 'Failed to get training status'
      }))
    }
  }

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = getAdminToken()
      if (!token) throw new Error('No admin token')

      const response = await fetch('http://localhost:3001/api/admin/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description,
          topic: formData.topic,
          guidelines: formData.guidelines,
          budget: parseInt(formData.budget),
          reward_per_roast: parseFloat(formData.reward_per_roast),
          max_submissions: parseInt(formData.max_submissions),
          end_date: formData.end_date,
        }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        // Reset form and close modal
        setFormData({
          title: '',
          description: '',
          topic: '',
          guidelines: '',
          budget: '',
          reward_per_roast: '',
          max_submissions: '',
          end_date: ''
        })
        setShowCreateForm(false)
        
        // Refresh campaigns list
        refetchCampaigns()
      } else {
        alert(data.error || 'Failed to create campaign')
      }
    } catch (error) {
      alert('Failed to create campaign')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  if (!adminUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading admin dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
                  <FireIconSolid className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold gradient-text">Burnie Admin</h1>
                  <p className="text-xs text-gray-500">Campaign Management</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Welcome, {adminUser.username}</span>
              <button
                onClick={handleLogout}
                className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowRightOnRectangleIcon className="h-5 w-5" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Dashboard Overview */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Campaign Dashboard</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="metric-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Campaigns</p>
                  <p className="text-2xl font-bold text-gray-900">{campaigns?.items?.length || 0}</p>
                </div>
                <MegaphoneIcon className="h-8 w-8 text-orange-500" />
              </div>
            </div>

            <div className="metric-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Active Campaigns</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {campaigns?.items?.filter((c: Campaign) => c.status === 'active').length || 0}
                  </p>
                </div>
                <ChartBarIcon className="h-8 w-8 text-green-500" />
              </div>
            </div>

            <div className="metric-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Budget</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {campaigns?.items?.reduce((sum: number, c: Campaign) => sum + Number(c.rewardPool || 0), 0)?.toLocaleString() || '0'} ROAST
                  </p>
                </div>
                <CurrencyDollarIcon className="h-8 w-8 text-blue-500" />
              </div>
            </div>

            <div className="metric-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Max Submissions</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {campaigns?.items?.reduce((sum: number, c: Campaign) => sum + Number(c.maxSubmissions || 0), 0)?.toLocaleString() || '0'}
                  </p>
                </div>
                <UsersIcon className="h-8 w-8 text-purple-500" />
              </div>
            </div>
          </div>
        </div>

        {/* ML Training Section */}
        <div className="mb-8">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl">
                  <CpuChipIcon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Mindshare ML Models</h3>
                  <p className="text-sm text-gray-600">Train AI models for mindshare prediction across platforms</p>
                </div>
              </div>
              <button
                onClick={() => setMlTraining(prev => ({ ...prev, showMLSection: !prev.showMLSection }))}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                {mlTraining.showMLSection ? 'Hide Details' : 'Show Details'}
              </button>
            </div>

            {mlTraining.showMLSection && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2 mb-2">
                      <CheckCircleIcon className="h-5 w-5 text-green-500" />
                      <span className="font-medium">Training Data</span>
                    </div>
                    <p className="text-sm text-gray-600">100+ training records across cookie.fun and yaps.kaito.ai</p>
                  </div>
                  
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2 mb-2">
                      <CpuChipIcon className="h-5 w-5 text-blue-500" />
                      <span className="font-medium">Algorithms</span>
                    </div>
                    <p className="text-sm text-gray-600">Random Forest, Gradient Boosting, SVR, and more</p>
                  </div>
                  
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2 mb-2">
                      <ClockIcon className="h-5 w-5 text-orange-500" />
                      <span className="font-medium">Training Time</span>
                    </div>
                    <p className="text-sm text-gray-600">~3-5 minutes per platform</p>
                  </div>
                </div>

                {mlTraining.isTraining && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center space-x-3 mb-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                      <span className="font-medium text-blue-900">Training in Progress</span>
                    </div>
                    <div className="mb-2">
                      <div className="flex justify-between text-sm text-blue-800 mb-1">
                        <span>{mlTraining.message}</span>
                        <span>{mlTraining.progress}%</span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${mlTraining.progress}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                )}

                {!mlTraining.isTraining && mlTraining.message && (
                  <div className={`border rounded-lg p-4 ${
                    mlTraining.message.includes('completed') 
                      ? 'bg-green-50 border-green-200 text-green-800' 
                      : mlTraining.message.includes('failed') 
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : 'bg-gray-50 border-gray-200 text-gray-800'
                  }`}>
                    <p className="text-sm">{mlTraining.message}</p>
                  </div>
                )}

                                <div className="flex space-x-3">
                  <button
                    onClick={() => startMLTraining('random_forest')}
                    disabled={mlTraining.isTraining}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    <CpuChipIcon className="h-4 w-4" />
                    <span>{mlTraining.isTraining ? 'Training...' : 'Train All Models'}</span>
                  </button>
                  
                  <a
                    href="http://localhost:8000/docs#/Admin%20ML"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                  >
                    View API Docs
                  </a>
                </div>

                {mlTraining.trainingResults && (
                  <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h4 className="text-lg font-semibold text-gray-900 mb-4">🎯 Ensemble Training Results</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                        <p className="text-sm text-blue-600 font-medium">Total Platforms</p>
                        <p className="text-2xl font-bold text-blue-900">{mlTraining.trainingResults.total_platforms || 0}</p>
                      </div>
                      <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                        <p className="text-sm text-green-600 font-medium">Successful Models</p>
                        <p className="text-2xl font-bold text-green-900">{mlTraining.trainingResults.successful || 0}</p>
                      </div>
                      <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                        <p className="text-sm text-purple-600 font-medium">Total Algorithms</p>
                        <p className="text-2xl font-bold text-purple-900">{mlTraining.trainingResults.total_models || 0}</p>
                      </div>
                      <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                        <p className="text-sm text-red-600 font-medium">Failed Models</p>
                        <p className="text-2xl font-bold text-red-900">{mlTraining.trainingResults.failed || 0}</p>
                      </div>
                    </div>

                    {mlTraining.trainingResults.platforms && (
                      <div className="space-y-4">
                        <h5 className="text-md font-semibold text-gray-800">📊 Platform Performance Details</h5>
                        {Object.entries(mlTraining.trainingResults.platforms).map(([platform, result]: [string, any]) => (
                          <div key={platform} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                              <h6 className="text-lg font-medium text-gray-900">🌐 {platform}</h6>
                              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                                result.status === 'success' 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {result.status === 'success' ? '✅ Success' : '❌ Failed'}
                              </span>
                            </div>
                            
                            {result.status === 'success' && result.metadata && (
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="bg-gray-50 p-4 rounded-lg">
                                  <div className="text-sm font-semibold text-gray-700 mb-2">🎯 Ensemble Performance</div>
                                  <div className="space-y-1">
                                    <div className="flex justify-between">
                                      <span className="text-sm text-gray-600">R² Score:</span>
                                      <span className="text-sm font-medium text-purple-600">
                                        {(result.metadata.ensemble_metrics?.r2 * 100 || 0).toFixed(1)}%
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-sm text-gray-600">RMSE:</span>
                                      <span className="text-sm font-medium text-gray-900">
                                        {result.metadata.ensemble_metrics?.rmse?.toFixed(4) || 'N/A'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-sm text-gray-600">Training Samples:</span>
                                      <span className="text-sm font-medium text-gray-900">
                                        {result.metadata.training_samples || 0}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="bg-gray-50 p-4 rounded-lg">
                                  <div className="text-sm font-semibold text-gray-700 mb-2">🤖 Algorithm Performance</div>
                                  <div className="space-y-1 max-h-20 overflow-y-auto">
                                    {result.metadata.individual_metrics && Object.entries(result.metadata.individual_metrics).map(([algorithm, metrics]: [string, any]) => (
                                      <div key={algorithm} className="flex justify-between text-xs">
                                        <span className="text-gray-600 capitalize">{algorithm.replace('_', ' ')}:</span>
                                        <span className="font-medium text-blue-600">
                                          {(metrics.r2 * 100 || 0).toFixed(1)}%
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                            
                            {result.status !== 'success' && (
                              <div className="bg-red-50 p-3 rounded border border-red-200">
                                <p className="text-sm text-red-700">
                                  <strong>Error:</strong> {result.message || 'Training failed'}
                                </p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Create Campaign Button */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-semibold text-gray-900">Campaign Management</h3>
          <button
            onClick={() => setShowCreateForm(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <PlusIcon className="h-5 w-5" />
            <span>Create Campaign</span>
          </button>
        </div>

        {/* Campaigns List */}
        <div className="card">
          <div className="card-header">
            <h4 className="text-lg font-semibold text-gray-900">All Campaigns</h4>
            <p className="text-sm text-gray-500">Manage your platform campaigns</p>
          </div>
          
          {campaignsLoading ? (
            <div className="card-content text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading campaigns...</p>
            </div>
          ) : campaigns?.items && campaigns.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reward Pool</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submissions</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">End Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {campaigns.items.map((campaign: Campaign) => (
                    <tr key={campaign.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div>
                          <div className="font-medium text-gray-900">{campaign.title}</div>
                          <div className="text-sm text-gray-500 truncate max-w-xs">{campaign.description}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{campaign.category}</td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {Number(campaign.rewardPool || 0).toLocaleString()} {campaign.rewardToken || 'ROAST'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{Number(campaign.maxSubmissions || 0).toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <span className={`status-indicator ${
                          campaign.status === 'ACTIVE' ? 'status-active' :
                          campaign.status === 'COMPLETED' ? 'status-completed' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1).toLowerCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {campaign.endDate ? formatDate(campaign.endDate) : 'No end date'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card-content text-center py-12">
              <MegaphoneIcon className="h-16 w-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-500 text-lg">No campaigns created yet</p>
              <p className="text-gray-400 text-sm">Create your first campaign to get started</p>
            </div>
          )}
        </div>
      </div>

      {/* Create Campaign Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Create New Campaign</h3>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            <form onSubmit={handleCreateCampaign} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                    Campaign Title *
                  </label>
                  <input
                    type="text"
                    id="title"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="input-field"
                    placeholder="Enter campaign title"
                  />
                </div>

                <div>
                  <label htmlFor="topic" className="block text-sm font-medium text-gray-700 mb-2">
                    Topic *
                  </label>
                  <input
                    type="text"
                    id="topic"
                    required
                    value={formData.topic}
                    onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                    className="input-field"
                    placeholder="Campaign topic"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                  Description *
                </label>
                <textarea
                  id="description"
                  required
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-field"
                  placeholder="Describe the campaign objectives and requirements"
                />
              </div>

              <div>
                <label htmlFor="guidelines" className="block text-sm font-medium text-gray-700 mb-2">
                  Guidelines
                </label>
                <textarea
                  id="guidelines"
                  rows={2}
                  value={formData.guidelines}
                  onChange={(e) => setFormData({ ...formData, guidelines: e.target.value })}
                  className="input-field"
                  placeholder="Optional content guidelines and requirements"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label htmlFor="budget" className="block text-sm font-medium text-gray-700 mb-2">
                    Budget (ROAST) *
                  </label>
                  <input
                    type="number"
                    id="budget"
                    required
                    min="1"
                    value={formData.budget}
                    onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                    className="input-field"
                    placeholder="10000"
                  />
                </div>

                <div>
                  <label htmlFor="reward_per_roast" className="block text-sm font-medium text-gray-700 mb-2">
                    Reward per ROAST *
                  </label>
                  <input
                    type="number"
                    id="reward_per_roast"
                    required
                    min="0.01"
                    step="0.01"
                    value={formData.reward_per_roast}
                    onChange={(e) => setFormData({ ...formData, reward_per_roast: e.target.value })}
                    className="input-field"
                    placeholder="1.5"
                  />
                </div>

                <div>
                  <label htmlFor="max_submissions" className="block text-sm font-medium text-gray-700 mb-2">
                    Max Submissions *
                  </label>
                  <input
                    type="number"
                    id="max_submissions"
                    required
                    min="1"
                    value={formData.max_submissions}
                    onChange={(e) => setFormData({ ...formData, max_submissions: e.target.value })}
                    className="input-field"
                    placeholder="1000"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="end_date" className="block text-sm font-medium text-gray-700 mb-2">
                  End Date *
                </label>
                <input
                  type="date"
                  id="end_date"
                  required
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="input-field"
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating...' : 'Create Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
} 