'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api, { analyticsApi, projectsApi, campaignsApi } from '@/services/api'
import DashboardStats from './DashboardStats'
import ProjectsList from './ProjectsList'
import CampaignsList from './CampaignsList'
import CreateProjectModal from './modals/CreateProjectModal'
import CreateCampaignModal from './modals/CreateCampaignModal'
import { PlusIcon, ChartBarIcon, FolderIcon, MegaphoneIcon, FireIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'
import { FireIcon as FireIconSolid } from '@heroicons/react/24/solid'

interface DashboardData {
  totalCampaigns: number;
  activeCampaigns: number;
  totalSubmissions: number;
  totalMiners: number;
  totalProjects: number;
  totalRewardsDistributed: number;
  averageScore: number;
  approvalRate: number;
  pendingSubmissions: number;
  approvedSubmissions: number;
  recentActivity: {
    newCampaigns: number;
    newSubmissions: number;
    newMiners: number;
  };
}

export default function Dashboard() {
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    totalCampaigns: 0,
    activeCampaigns: 0,
    totalSubmissions: 0,
    totalMiners: 0,
    totalProjects: 0,
    totalRewardsDistributed: 0,
    averageScore: 0,
    approvalRate: 0,
    pendingSubmissions: 0,
    approvedSubmissions: 0,
    recentActivity: {
      newCampaigns: 0,
      newSubmissions: 0,
      newMiners: 0,
    },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'projects' | 'campaigns'>('overview')
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [showCreateCampaign, setShowCreateCampaign] = useState(false)

  const queryClient = useQueryClient()

  // Fetch dashboard analytics
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: analyticsApi.getDashboard,
    refetchInterval: 30000, // Refetch every 30 seconds
    staleTime: 10000, // Consider data stale after 10 seconds
  })

  // Fetch projects
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(1, 10),
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000,
  })

  // Fetch campaigns
  const { data: campaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignsApi.getAll(1, 10),
    refetchInterval: 30000, // Refetch every 30 seconds
    staleTime: 10000,
  })

  useEffect(() => {
    // Only show real data from the database - no mock data
    if (analytics) {
      setDashboardData({
        totalCampaigns: analytics.total_campaigns || 0,
        activeCampaigns: analytics.active_campaigns || 0,
        totalSubmissions: analytics.total_submissions || 0,
        totalMiners: analytics.total_miners || 0,
        totalProjects: analytics.total_projects || 0,
        totalRewardsDistributed: analytics.total_rewards_distributed || 0,
        averageScore: analytics.avg_submission_score || 0,
        approvalRate: analytics.performance_metrics?.approval_rate || 0,
        pendingSubmissions: analytics.pending_submissions || 0,
        approvedSubmissions: analytics.approved_submissions || 0,
        recentActivity: {
          newCampaigns: analytics.growth_metrics?.current_period?.campaigns || 0,
          newSubmissions: analytics.growth_metrics?.current_period?.submissions || 0,
          newMiners: 0, // Not tracked in current analytics
        },
      });
    } else {
      // If no analytics data, show all zeros (no mock data)
      setDashboardData({
        totalCampaigns: 0,
        activeCampaigns: 0,
        totalSubmissions: 0,
        totalMiners: 0,
        totalProjects: 0,
        totalRewardsDistributed: 0,
        averageScore: 0,
        approvalRate: 0,
        pendingSubmissions: 0,
        approvedSubmissions: 0,
        recentActivity: {
          newCampaigns: 0,
          newSubmissions: 0,
          newMiners: 0,
        },
      });
    }
    setLoading(false);
  }, [analytics, campaigns, projects]);

  const handleProjectCreated = () => {
    setShowCreateProject(false);
    // Refresh data immediately
    queryClient.invalidateQueries({ queryKey: ['projects'] })
    queryClient.invalidateQueries({ queryKey: ['analytics'] })
    queryClient.invalidateQueries({ queryKey: ['analytics', 'dashboard'] })
  };

  const handleCampaignCreated = () => {
    setShowCreateCampaign(false);
    // Refresh data immediately
    queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    queryClient.invalidateQueries({ queryKey: ['analytics'] })
    queryClient.invalidateQueries({ queryKey: ['analytics', 'dashboard'] })
  };

  const tabs = [
    { key: 'overview', label: 'Overview', icon: ChartBarIcon },
    { key: 'projects', label: 'Projects', icon: FolderIcon },
    { key: 'campaigns', label: 'Campaigns', icon: MegaphoneIcon },
  ]

  if (loading && dashboardData.totalCampaigns === 0) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 mb-4">⚠️ Error</div>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => {
              // Refresh data
            }}
            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <header className="bg-gray-900/80 backdrop-blur-md border-b border-gray-700/50 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center space-x-4">
              <a href="/" className="flex items-center space-x-2 text-gray-400 hover:text-white transition-colors">
                <ArrowLeftIcon className="h-4 w-4" />
                <span className="text-sm">Back to Home</span>
              </a>
              <div className="h-6 w-px bg-gray-700"></div>
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
                  <FireIconSolid className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent">
                    Campaign Manager
                  </h1>
                  <p className="text-sm text-gray-400">
                    Manage your AI-powered campaigns
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowCreateProject(true)}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors font-medium flex items-center space-x-2"
              >
                <PlusIcon className="h-4 w-4" />
                <span>New Project</span>
              </button>
              <button
                onClick={() => setShowCreateCampaign(true)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium flex items-center space-x-2 border border-gray-600"
              >
                <PlusIcon className="h-4 w-4" />
                <span>New Campaign</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as any)}
                  className={`${
                    activeTab === tab.key
                      ? 'border-orange-500 text-orange-400 bg-orange-500/10'
                      : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600'
                  } whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm flex items-center transition-all duration-200 rounded-t-lg`}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-fade-in">
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-white">Platform Overview</h2>
                <div className="flex items-center space-x-2 text-sm text-gray-400">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                    Live Data
                  </span>
                </div>
              </div>
              <DashboardStats 
                totalCampaigns={dashboardData.totalCampaigns}
                activeCampaigns={dashboardData.activeCampaigns}
                totalSubmissions={dashboardData.totalSubmissions}
                totalMiners={dashboardData.totalMiners}
                totalProjects={dashboardData.totalProjects}
                totalRewardsDistributed={dashboardData.totalRewardsDistributed}
                averageScore={dashboardData.averageScore}
                approvalRate={dashboardData.approvalRate}
                pendingSubmissions={dashboardData.pendingSubmissions}
                approvedSubmissions={dashboardData.approvedSubmissions}
                recentActivity={dashboardData.recentActivity}
              />
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-white">
                      Recent Projects
                    </h3>
                    <FolderIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <ProjectsList 
                    projects={projects?.items?.slice(0, 5) || []} 
                    loading={projectsLoading}
                    compact
                  />
                  {!projectsLoading && (!projects?.items || projects.items.length === 0) && (
                    <div className="text-center py-8 text-gray-400">
                      <FolderIcon className="h-12 w-12 mx-auto mb-4 text-gray-600" />
                      <p className="text-sm font-medium">No projects yet</p>
                      <p className="text-xs">Create your first project to get started</p>
                    </div>
                  )}
                </div>
                
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-white">
                      Active Campaigns
                    </h3>
                    <MegaphoneIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <CampaignsList 
                    campaigns={campaigns?.items?.filter(c => c.status === 'active').slice(0, 5) || []} 
                    loading={campaignsLoading}
                    compact
                  />
                  {!campaignsLoading && (!campaigns?.items || campaigns.items.filter(c => c.status === 'active').length === 0) && (
                    <div className="text-center py-8 text-gray-400">
                      <MegaphoneIcon className="h-12 w-12 mx-auto mb-4 text-gray-600" />
                      <p className="text-sm font-medium">No active campaigns</p>
                      <p className="text-xs">Launch your first campaign to start generating content</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-white">
                  All Projects
                </h2>
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors font-medium flex items-center space-x-2"
                >
                  <PlusIcon className="h-4 w-4" />
                  <span>New Project</span>
                </button>
              </div>
              <ProjectsList 
                projects={projects?.items || []} 
                loading={projectsLoading}
              />
            </div>
          )}

          {activeTab === 'campaigns' && (
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-white">
                  All Campaigns
                </h2>
                <button
                  onClick={() => setShowCreateCampaign(true)}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors font-medium flex items-center space-x-2"
                >
                  <PlusIcon className="h-4 w-4" />
                  <span>New Campaign</span>
                </button>
              </div>
              <CampaignsList 
                campaigns={campaigns?.items || []} 
                loading={campaignsLoading}
              />
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <CreateProjectModal
        isOpen={showCreateProject}
        onClose={() => setShowCreateProject(false)}
        onSuccess={handleProjectCreated}
      />
      
      <CreateCampaignModal
        isOpen={showCreateCampaign}
        onClose={() => setShowCreateCampaign(false)}
        onSuccess={handleCampaignCreated}
      />
    </div>
  )
}
