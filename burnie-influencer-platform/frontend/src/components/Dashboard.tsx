'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import api, { analyticsApi, projectsApi, campaignsApi } from '@/services/api'
import DashboardStats from './DashboardStats'
import ProjectsList from './ProjectsList'
import CampaignsList from './CampaignsList'
import CreateProjectModal from './modals/CreateProjectModal'
import CreateCampaignModal from './modals/CreateCampaignModal'
import { PlusIcon, ChartBarIcon, FolderIcon, MegaphoneIcon, FireIcon } from '@heroicons/react/24/outline'

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

  // Fetch dashboard analytics
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: analyticsApi.getDashboard,
  })

  // Fetch projects
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(1, 10),
  })

  // Fetch campaigns
  const { data: campaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignsApi.getAll(1, 10),
  })

  useEffect(() => {
    fetchDashboardData();
    // Refresh data every 30 seconds
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch data from multiple endpoints in parallel
      const [
        campaignsResponse,
        projectsResponse,
        minersResponse,
        submissionsResponse,
        analyticsResponse
      ] = await Promise.all([
        api.get('/api/campaigns?limit=1000'),
        api.get('/api/projects?limit=1000'),
        api.get('/api/miners?limit=1000'),
        api.get('/api/submissions?limit=1000'),
        api.get('/api/analytics/dashboard').catch(() => ({ data: { data: null } }))
      ]);

      const campaigns = campaignsResponse.data.data || [];
      const projects = projectsResponse.data.data || [];
      const miners = minersResponse.data.data || [];
      const submissions = submissionsResponse.data.data || [];
      const analytics = analyticsResponse.data.data;

      // Calculate metrics
      const activeCampaigns = campaigns.filter((c: any) => c.status === 'ACTIVE').length;
      const totalSubmissions = submissions.length;
      const approvedSubmissions = submissions.filter((s: any) => s.status === 'APPROVED').length;
      const pendingSubmissions = submissions.filter((s: any) => s.status === 'PENDING').length;
      const totalRewardsDistributed = campaigns.reduce((sum: number, c: any) => 
        sum + (c.rewardPool || 0), 0
      );
      
      // Calculate average score
      const submissionsWithScores = submissions.filter((s: any) => s.totalScore > 0);
      const averageScore = submissionsWithScores.length > 0 ? 
        submissionsWithScores.reduce((sum: number, s: any) => sum + s.totalScore, 0) / submissionsWithScores.length : 0;
      
      // Calculate approval rate
      const approvalRate = totalSubmissions > 0 ? (approvedSubmissions / totalSubmissions) * 100 : 0;

      // Calculate recent activity (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentCampaigns = campaigns.filter((c: any) => 
        new Date(c.createdAt) > sevenDaysAgo
      ).length;
      const recentSubmissions = submissions.filter((s: any) => 
        new Date(s.createdAt) > sevenDaysAgo
      ).length;
      const recentMiners = miners.filter((m: any) => 
        new Date(m.createdAt) > sevenDaysAgo
      ).length;

      setDashboardData({
        totalCampaigns: campaigns.length,
        activeCampaigns,
        totalSubmissions,
        totalMiners: miners.length,
        totalProjects: projects.length,
        totalRewardsDistributed,
        averageScore: Math.round(averageScore * 10) / 10,
        approvalRate: Math.round(approvalRate * 10) / 10,
        pendingSubmissions,
        approvedSubmissions,
        recentActivity: {
          newCampaigns: recentCampaigns,
          newSubmissions: recentSubmissions,
          newMiners: recentMiners,
        },
      });

    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setError('Failed to load dashboard data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleProjectCreated = () => {
    setShowCreateProject(false);
    fetchDashboardData(); // Refresh data
  };

  const handleCampaignCreated = () => {
    setShowCreateCampaign(false);
    fetchDashboardData(); // Refresh data
  };

  const tabs = [
    { key: 'overview', label: 'Overview', icon: ChartBarIcon },
    { key: 'projects', label: 'Projects', icon: FolderIcon },
    { key: 'campaigns', label: 'Campaigns', icon: MegaphoneIcon },
  ]

  if (loading && dashboardData.totalCampaigns === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 mb-4">⚠️ Error</div>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={fetchDashboardData}
            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-50 via-white to-primary-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md shadow-soft border-b border-secondary-200/50 sticky top-0 z-30">
        <div className="container-app">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gradient-to-br from-primary-500 to-roast-500 rounded-xl shadow-medium">
                  <FireIcon className="h-8 w-8 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-gradient">
                    Burnie Influencer Platform
                  </h1>
                  <p className="text-sm text-secondary-600 font-medium">
                    Manage your AI-powered roast campaigns
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowCreateProject(true)}
                className="btn-primary"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                New Project
              </button>
              <button
                onClick={() => setShowCreateCampaign(true)}
                className="btn-secondary"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                New Campaign
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-white/60 backdrop-blur-sm border-b border-secondary-200/50">
        <div className="container-app">
          <nav className="flex space-x-8">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as any)}
                  className={`${
                    activeTab === tab.key
                      ? 'border-primary-500 text-primary-600 bg-primary-50/50'
                      : 'border-transparent text-secondary-500 hover:text-secondary-700 hover:border-secondary-300'
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
      <main className="container-app py-8">
        <div className="animate-fade-in">
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Platform Overview</h2>
                <div className="flex items-center space-x-2 text-sm text-gray-500">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
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
                <div className="card p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-secondary-900">
                      Recent Projects
                    </h3>
                    <FolderIcon className="h-5 w-5 text-secondary-400" />
                  </div>
                  <ProjectsList 
                    projects={projects?.items?.slice(0, 5) || []} 
                    loading={projectsLoading}
                    compact
                  />
                  {!projectsLoading && (!projects?.items || projects.items.length === 0) && (
                    <div className="text-center py-8 text-secondary-500">
                      <FolderIcon className="h-12 w-12 mx-auto mb-4 text-secondary-300" />
                      <p className="text-sm font-medium">No projects yet</p>
                      <p className="text-xs">Create your first project to get started</p>
                    </div>
                  )}
                </div>
                
                <div className="card p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-secondary-900">
                      Active Campaigns
                    </h3>
                    <MegaphoneIcon className="h-5 w-5 text-secondary-400" />
                  </div>
                  <CampaignsList 
                    campaigns={campaigns?.items?.filter(c => c.status === 'active').slice(0, 5) || []} 
                    loading={campaignsLoading}
                    compact
                  />
                  {!campaignsLoading && (!campaigns?.items || campaigns.items.filter(c => c.status === 'active').length === 0) && (
                    <div className="text-center py-8 text-secondary-500">
                      <MegaphoneIcon className="h-12 w-12 mx-auto mb-4 text-secondary-300" />
                      <p className="text-sm font-medium">No active campaigns</p>
                      <p className="text-xs">Launch your first campaign to start generating roasts</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-secondary-900">
                  All Projects
                </h2>
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="btn-primary text-sm"
                >
                  <PlusIcon className="h-4 w-4 mr-2" />
                  New Project
                </button>
              </div>
              <ProjectsList 
                projects={projects?.items || []} 
                loading={projectsLoading}
              />
            </div>
          )}

          {activeTab === 'campaigns' && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-secondary-900">
                  All Campaigns
                </h2>
                <button
                  onClick={() => setShowCreateCampaign(true)}
                  className="btn-primary text-sm"
                >
                  <PlusIcon className="h-4 w-4 mr-2" />
                  New Campaign
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
