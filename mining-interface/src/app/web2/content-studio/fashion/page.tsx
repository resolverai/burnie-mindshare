'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'

interface WorkflowOption {
  id: string
  title: string
  description: string
  icon: string
  color: string
  features: string[]
  recommended?: boolean
}

const fashionWorkflows: WorkflowOption[] = [
  {
    id: 'model-diversity',
    title: 'Model Diversity Showcase',
    description: 'Show your product on diverse models to appeal to a wider audience',
    icon: '👥',
    color: 'from-blue-500 to-cyan-500',
    features: [
      'Multiple model variations',
      'Diverse ethnicities & body types',
      'Professional photography style',
      'Perfect for inclusivity campaigns'
    ],
    recommended: true
  },
  {
    id: 'lifestyle-context',
    title: 'Lifestyle & Context Variations',
    description: 'Showcase your product in different real-world scenarios and use cases',
    icon: '🌆',
    color: 'from-purple-500 to-pink-500',
    features: [
      'Multiple lifestyle contexts',
      'Real-world scenarios',
      'Versatile product showcase',
      'Great for storytelling'
    ]
  },
  {
    id: 'color-style',
    title: 'Color & Style Variations',
    description: 'Display your product design in multiple color options and patterns',
    icon: '🎨',
    color: 'from-orange-500 to-red-500',
    features: [
      'Multiple color options',
      'Consistent design',
      'Trending color palettes',
      'E-commerce ready'
    ]
  },
  {
    id: 'before-after',
    title: 'Before/After Styling',
    description: 'Show transformation with styling tips and multiple looks',
    icon: '✨',
    color: 'from-green-500 to-teal-500',
    features: [
      'Style progression',
      'Versatility showcase',
      'Styling tips included',
      'Engagement booster'
    ]
  },
  {
    id: 'seasonal',
    title: 'Seasonal Campaign',
    description: 'Create timely seasonal content for your marketing campaigns',
    icon: '🍂',
    color: 'from-yellow-500 to-orange-500',
    features: [
      'Season-specific themes',
      'Holiday campaigns',
      'Timely & relevant',
      'Sales & promotions'
    ]
  }
]

export default function FashionWorkflowsPage() {
  const router = useRouter()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null)

  const handleWorkflowSelect = (workflowId: string) => {
    router.push(`/web2/content-studio/fashion/${workflowId}`)
  }

  return (
    <div className="flex h-screen bg-gray-900">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700/50 px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <button
                  onClick={() => router.push('/web2/content-studio')}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ← Back
                </button>
                <h1 className="text-3xl font-bold text-white">Fashion & Apparel</h1>
              </div>
              <p className="text-gray-400">
                Choose a workflow to create stunning product images for your fashion brand
              </p>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto">
            {/* Workflows Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {fashionWorkflows.map((workflow) => (
                <div
                  key={workflow.id}
                  className="relative group"
                >
                  {workflow.recommended && (
                    <div className="absolute -top-3 -right-3 z-10">
                      <span className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black text-xs font-bold px-3 py-1 rounded-full shadow-lg">
                        ⭐ Recommended
                      </span>
                    </div>
                  )}
                  
                  <button
                    onClick={() => handleWorkflowSelect(workflow.id)}
                    className={`w-full bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6 text-left
                      transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-${workflow.color}/20
                      hover:border-gray-600 group-hover:bg-gray-800/70`}
                  >
                    {/* Icon & Title */}
                    <div className="flex items-start space-x-4 mb-4">
                      <div className={`text-5xl bg-gradient-to-br ${workflow.color} bg-clip-text text-transparent`}>
                        {workflow.icon}
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-white mb-2 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text group-hover:from-blue-400 group-hover:to-purple-400">
                          {workflow.title}
                        </h3>
                        <p className="text-sm text-gray-400">
                          {workflow.description}
                        </p>
                      </div>
                    </div>

                    {/* Features */}
                    <ul className="space-y-2 mb-4">
                      {workflow.features.map((feature, idx) => (
                        <li key={idx} className="flex items-center text-sm text-gray-300">
                          <svg className="w-4 h-4 mr-2 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          {feature}
                        </li>
                      ))}
                    </ul>

                    {/* CTA */}
                    <div className="flex items-center justify-between pt-4 border-t border-gray-700">
                      <span className="text-sm text-gray-500">Click to start</span>
                      <svg className="w-5 h-5 text-gray-400 group-hover:text-white group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                </div>
              ))}
            </div>

            {/* Help Section */}
            <div className="mt-12 bg-gradient-to-br from-blue-900/20 to-purple-900/20 border border-blue-500/20 rounded-xl p-6">
              <h3 className="text-lg font-bold text-white mb-3 flex items-center">
                <span className="text-2xl mr-3">💡</span>
                Quick Tips for Fashion Content
              </h3>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-300">
                <li className="flex items-start">
                  <span className="text-blue-400 mr-2">•</span>
                  Upload high-quality product images for best results
                </li>
                <li className="flex items-start">
                  <span className="text-blue-400 mr-2">•</span>
                  Use Model Diversity for inclusivity marketing
                </li>
                <li className="flex items-start">
                  <span className="text-blue-400 mr-2">•</span>
                  Lifestyle Context works great for storytelling
                </li>
                <li className="flex items-start">
                  <span className="text-blue-400 mr-2">•</span>
                  Color Variations are perfect for e-commerce listings
                </li>
              </ul>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

