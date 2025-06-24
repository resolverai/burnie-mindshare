import { Project } from '@/types'

interface ProjectsListProps {
  projects: Project[]
  loading: boolean
  compact?: boolean
}

export default function ProjectsList({ projects, loading, compact = false }: ProjectsListProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="skeleton h-5 w-3/4 mb-2"></div>
            <div className="skeleton h-4 w-full mb-2"></div>
            <div className="skeleton h-4 w-1/2"></div>
          </div>
        ))}
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-4xl mb-4">📁</div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
        <p className="text-gray-500">Create your first project to get started.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {projects.map((project) => (
        <div key={project.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <h3 className="text-lg font-medium text-gray-900 mb-1">{project.title}</h3>
              <p className={`text-gray-600 mb-2 ${compact ? 'line-clamp-2' : ''}`}>
                {project.description}
              </p>
              <div className="flex items-center space-x-4 text-sm text-gray-500">
                <span>📧 {project.contact_email}</span>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  project.status === 'active' 
                    ? 'bg-green-100 text-green-800'
                    : project.status === 'draft'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {project.status}
                </span>
              </div>
            </div>
            {!compact && (
              <div className="ml-4">
                <button className="text-primary-600 hover:text-primary-900 text-sm font-medium">
                  View Details
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
} 