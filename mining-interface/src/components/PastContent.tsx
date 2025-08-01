import { 
  ClockIcon
} from '@heroicons/react/24/outline'

export default function PastContent() {
  return (
    <div 
      className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white p-8"
      style={{ height: '100vh', overflow: 'hidden' }}
    >
      <div 
        className="max-w-4xl mx-auto"
        style={{
          height: '100%',
          overflowY: 'auto',
          paddingRight: '16px',
          // Hide scrollbar for webkit browsers
          scrollbarWidth: 'none', // Firefox
          msOverflowStyle: 'none', // IE and Edge
        }}
      >
        <style jsx>{`
          div::-webkit-scrollbar {
            display: none;
          }
        `}</style>

        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white">Past Content</h2>
          <p className="text-gray-400 mt-2">View your content history and track performance</p>
        </div>
        
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-16 text-center">
          <ClockIcon className="h-20 w-20 mx-auto mb-6 text-gray-600" />
          <p className="text-xl text-gray-400 mb-4">Your content history will appear here</p>
          <p className="text-gray-500 text-lg">Track your previous submissions and performance metrics</p>
        </div>
      </div>
    </div>
  )
} 