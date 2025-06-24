interface ConnectionStatusProps {
  isApiConnected: boolean
  isWsConnected: boolean
  minerStatus: 'ONLINE' | 'OFFLINE' | 'MINING' | 'IDLE'
}

export function ConnectionStatus({ isApiConnected, isWsConnected, minerStatus }: ConnectionStatusProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ONLINE': return 'neon-green'
      case 'MINING': return 'neon-orange'
      case 'IDLE': return 'neon-blue'
      case 'OFFLINE': return 'neon-red'
      default: return 'text-gray-400'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ONLINE': return '🟢'
      case 'MINING': return '⚡'
      case 'IDLE': return '🟡'
      case 'OFFLINE': return '🔴'
      default: return '⚫'
    }
  }

  return (
    <div className="flex items-center space-x-4 text-xs">
      {/* API Status */}
      <div className="flex items-center space-x-1">
        <div className={`w-2 h-2 rounded-full ${isApiConnected ? 'status-online' : 'status-offline'}`}></div>
        <span className="text-gray-400">API</span>
      </div>

      {/* WebSocket Status */}
      <div className="flex items-center space-x-1">
        <div className={`w-2 h-2 rounded-full ${isWsConnected ? 'status-online' : 'status-offline'}`}></div>
        <span className="text-gray-400">WS</span>
      </div>

      {/* Miner Status */}
      <div className="flex items-center space-x-1">
        <span>{getStatusIcon(minerStatus)}</span>
        <span className={`neon-text ${getStatusColor(minerStatus)} font-mono font-bold`}>
          {minerStatus}
        </span>
      </div>
    </div>
  )
} 