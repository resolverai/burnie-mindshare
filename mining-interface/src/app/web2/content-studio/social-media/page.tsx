'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import { 
  FireIcon, 
  AcademicCapIcon, 
  CameraIcon, 
  SparklesIcon,
  ChatBubbleLeftRightIcon
} from '@heroicons/react/24/outline'

export default function SocialMediaWorkflowsPage() {
  const router = useRouter()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)

  const workflows = [
    {
      id: 'viral-trend',
      title: 'Viral Trend Content',
      description: 'Create timely content based on current trending topics, viral posts, and popular hashtags',
      icon: FireIcon,
      color: 'from-red-500 to-orange-500',
      features: ['Real-time trends', 'Hashtag optimization', 'Quick turnaround']
    },
    {
      id: 'educational',
      title: 'Educational/How-To Posts',
      description: 'Generate step-by-step visual guides, infographics, and tutorial content',
      icon: AcademicCapIcon,
      color: 'from-blue-500 to-cyan-500',
      features: ['Step-by-step guides', 'Infographic style', 'Tips & tutorials']
    },
    {
      id: 'behind-scenes',
      title: 'Behind-the-Scenes',
      description: 'Showcase authentic brand moments, team culture, and process reveals',
      icon: CameraIcon,
      color: 'from-purple-500 to-pink-500',
      features: ['Team highlights', 'Process reveals', 'Authentic moments']
    },
    {
      id: 'product-showcase',
      title: 'Product/Service Showcase',
      description: 'Create professional product photography with feature highlights and benefits',
      icon: SparklesIcon,
      color: 'from-green-500 to-emerald-500',
      features: ['Product focus', 'Feature highlights', 'Benefit-driven']
    },
    {
      id: 'quote-inspiration',
      title: 'Quote & Inspiration',
      description: 'Design motivational quotes, industry insights, and thought leadership content',
      icon: ChatBubbleLeftRightIcon,
      color: 'from-yellow-500 to-amber-500',
      features: ['Branded quotes', 'Motivational', 'Thought leadership']
    }
  ]

  const handleWorkflowClick = (workflowId: string) => {
    router.push('/web2/content-studio/social-media/' + workflowId)
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 overflow-hidden">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
      
      <div className={'flex-1 flex flex-col overflow-hidden transition-all duration-300 ' + (sidebarExpanded ? 'ml-64' : 'ml-20')}>
        {/* Header */}
        <header className="h-16 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex items-center px-6 flex-shrink-0">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/web2/content-studio')}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ← Back
            </button>
            <h1 className="text-xl font-semibold text-white">Social Media Management Workflows</h1>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto">
            {/* Page Title */}
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-white mb-2">Choose Your Content Type</h2>
              <p className="text-gray-400">
                Select a workflow that matches your social media content needs
              </p>
            </div>

            {/* Workflow Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {workflows.map((workflow) => {
                const IconComponent = workflow.icon
                return (
                  <div
                    key={workflow.id}
                    onClick={() => handleWorkflowClick(workflow.id)}
                    className="group relative bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 hover:border-gray-600 p-6 cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-orange-500/10"
                  >
                    {/* Gradient Background on Hover */}
                    <div className={'absolute inset-0 bg-gradient-to-br ' + workflow.color + ' opacity-0 group-hover:opacity-10 rounded-2xl transition-opacity duration-300'} />
                    
                    {/* Content */}
                    <div className="relative z-10">
                      {/* Icon */}
                      <div className={'w-14 h-14 rounded-xl bg-gradient-to-br ' + workflow.color + ' flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300'}>
                        <IconComponent className="w-7 h-7 text-white" />
                      </div>

                      {/* Title */}
                      <h3 className="text-xl font-bold text-white mb-2 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-orange-400 group-hover:to-red-400 transition-all duration-300">
                        {workflow.title}
                      </h3>

                      {/* Description */}
                      <p className="text-gray-400 text-sm mb-4 leading-relaxed">
                        {workflow.description}
                      </p>

                      {/* Features */}
                      <div className="flex flex-wrap gap-2">
                        {workflow.features.map((feature, idx) => (
                          <span
                            key={idx}
                            className="px-3 py-1 bg-gray-700/50 text-gray-300 text-xs rounded-full border border-gray-600"
                          >
                            {feature}
                          </span>
                        ))}
                      </div>

                      {/* Arrow Icon */}
                      <div className="absolute top-6 right-6 text-gray-600 group-hover:text-orange-500 transition-colors duration-300">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Help Text */}
            <div className="mt-12 text-center">
              <p className="text-gray-500 text-sm">
                Need help choosing? Each workflow is optimized for specific social media use cases.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

