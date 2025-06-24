'use client'

import { Analytics } from '@/types'
import { useEffect, useState } from 'react'

interface DashboardStatsProps {
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

const StatCard = ({ 
  title, 
  value, 
  subtitle, 
  trend, 
  icon: Icon, 
  loading = false 
}: {
  title: string
  value: string | number
  subtitle?: string
  trend?: { value: number; label: string; positive?: boolean }
  icon: any
  loading?: boolean
}) => {
  if (loading) {
    return (
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <div className="skeleton h-4 w-24 rounded"></div>
            <div className="skeleton h-8 w-16 rounded"></div>
            <div className="skeleton h-3 w-20 rounded"></div>
          </div>
          <div className="skeleton h-10 w-10 rounded-lg"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="card-interactive p-6 group">
      <div className="flex items-center justify-between">
        <div className="space-y-2 flex-1">
          <p className="text-sm font-medium text-secondary-600 group-hover:text-secondary-700 transition-colors">
            {title}
          </p>
          <div className="flex items-baseline space-x-2">
            <p className="text-2xl font-bold text-secondary-900">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
            {trend && (
              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                trend.positive !== false 
                  ? 'bg-success-100 text-success-800' 
                  : 'bg-error-100 text-error-800'
              }`}>
                {trend.positive !== false ? '↗' : '↘'} {Math.abs(trend.value)}%
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-secondary-500 font-medium">
              {subtitle}
            </p>
          )}
        </div>
        <div className="p-3 bg-gradient-to-br from-primary-100 to-primary-200 rounded-xl group-hover:from-primary-200 group-hover:to-primary-300 transition-all duration-200">
          <Icon className="h-6 w-6 text-primary-600" />
        </div>
      </div>
      {trend && (
        <div className="mt-4 pt-4 border-t border-secondary-100">
          <p className="text-xs text-secondary-500">
            {trend.label}
          </p>
        </div>
      )}
    </div>
  )
}

export default function DashboardStats(props: DashboardStatsProps) {
  const [currentDate, setCurrentDate] = useState('')

  useEffect(() => {
    setCurrentDate(new Date().toLocaleDateString())
  }, [])

  const stats = [
    {
      title: 'Total Campaigns',
      value: props.totalCampaigns,
      subtitle: `${props.activeCampaigns} active`,
      trend: { 
        value: props.recentActivity.newCampaigns, 
        label: 'new this week', 
        positive: true 
      },
      icon: (iconProps: any) => (
        <svg {...iconProps} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-10.08a23.848 23.848 0 000 9.75m0 0A23.74 23.74 0 0018.795 21M3.205 21a23.79 23.79 0 01-.38-1.125A23.91 23.91 0 011.81 14.48M3.205 3.002A23.634 23.634 0 011.81 9.397m1.014 8.855a23.848 23.848 0 000-9.75" />
        </svg>
      )
    },
    {
      title: 'Active Campaigns',
      value: props.activeCampaigns,
      subtitle: 'Currently running',
      trend: { 
        value: Math.round((props.activeCampaigns / Math.max(props.totalCampaigns, 1)) * 100), 
        label: 'of total campaigns', 
        positive: true 
      },
      icon: (iconProps: any) => (
        <svg {...iconProps} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
        </svg>
      )
    },
    {
      title: 'Total Submissions',
      value: props.totalSubmissions,
      subtitle: `${props.pendingSubmissions} pending review`,
      trend: { 
        value: props.recentActivity.newSubmissions, 
        label: 'new this week', 
        positive: true 
      },
      icon: (iconProps: any) => (
        <svg {...iconProps} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      )
    },
    {
      title: 'Total Miners',
      value: props.totalMiners,
      subtitle: 'Content creators',
      trend: { 
        value: props.recentActivity.newMiners, 
        label: 'new this week', 
        positive: true 
      },
      icon: (iconProps: any) => (
        <svg {...iconProps} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      )
    }
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-secondary-900">
          Platform Overview
        </h2>
        {currentDate && (
          <div className="text-sm text-secondary-500 font-medium">
            Last updated: {currentDate}
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <StatCard
            key={index}
            title={stat.title}
            value={stat.value}
            subtitle={stat.subtitle}
            trend={stat.trend}
            icon={stat.icon}
            loading={false}
          />
        ))}
      </div>

      {/* Additional metrics row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-8">
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-secondary-900">
              Performance
            </h3>
            <div className="p-2 bg-success-100 rounded-lg">
              <svg className="h-5 w-5 text-success-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.94" />
              </svg>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-600">Avg. Score</span>
              <span className="text-sm font-semibold text-secondary-900">
                {props.averageScore}/100
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-600">Approval Rate</span>
              <span className="text-sm font-semibold text-success-600">
                {props.approvalRate}%
              </span>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-secondary-900">
              Rewards
            </h3>
            <div className="p-2 bg-warning-100 rounded-lg">
              <svg className="h-5 w-5 text-warning-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-600">Total Distributed</span>
              <span className="text-sm font-semibold text-secondary-900">
                ${props.totalRewardsDistributed.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-600">Avg. per Submission</span>
              <span className="text-sm font-semibold text-warning-600">
                ${props.totalSubmissions > 0 ? Math.round(props.totalRewardsDistributed / props.totalSubmissions) : 0}
              </span>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-secondary-900">
              Status
            </h3>
            <div className="p-2 bg-info-100 rounded-lg">
              <svg className="h-5 w-5 text-info-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-600">Approved</span>
              <span className="text-sm font-semibold text-success-600">
                {props.approvedSubmissions}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-600">Pending</span>
              <span className="text-sm font-semibold text-warning-600">
                {props.pendingSubmissions}
              </span>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-secondary-900">
              Projects
            </h3>
            <div className="p-2 bg-primary-100 rounded-lg">
              <svg className="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25H11.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-600">Total Projects</span>
              <span className="text-sm font-semibold text-secondary-900">
                {props.totalProjects}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-600">Avg. Campaigns</span>
              <span className="text-sm font-semibold text-primary-600">
                {props.totalProjects > 0 ? Math.round(props.totalCampaigns / props.totalProjects) : 0}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 