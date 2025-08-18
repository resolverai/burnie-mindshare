'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Zap, Settings, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { toast } from 'sonner'

interface ProviderConfig {
  primary_provider: string
  fallback_provider: string
}

interface ProviderHealth {
  healthy: boolean
  response_time: number
  error?: string
}

interface ProviderStatus {
  overall_health: 'healthy' | 'degraded'
  providers: Record<string, ProviderHealth>
  config: ProviderConfig
}

export default function LLMProviderManager() {
  const [availableProviders, setAvailableProviders] = useState<string[]>([])
  const [currentConfig, setCurrentConfig] = useState<ProviderConfig | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isTesting, setIsTesting] = useState<string | null>(null)
  const [isConfiguring, setIsConfiguring] = useState(false)
  const [selectedPrimary, setSelectedPrimary] = useState<string>('openai')
  const [selectedFallback, setSelectedFallback] = useState<string>('anthropic')

  useEffect(() => {
    fetchProviderData()
    
    // Initial health check only - no automatic refresh to prevent cost escalation
    fetchProviderHealth()
    
    // Removed automatic health check interval to prevent frequent API calls and costs
    // Health status can be refreshed manually using the test buttons
  }, [])

  const fetchProviderData = async () => {
    try {
      setIsLoading(true)
      
      // Get Python AI backend URL
      const pythonBackendUrl = process.env.NEXT_PUBLIC_AI_BACKEND_URL || 'http://localhost:8000'
      console.log('🔍 Fetching provider data from:', pythonBackendUrl)
      
      // Fetch available providers and current config
      const [providersResponse, configResponse, healthResponse] = await Promise.all([
        fetch(`${pythonBackendUrl}/api/llm-providers/available`),
        fetch(`${pythonBackendUrl}/api/llm-providers/current`),
        fetch(`${pythonBackendUrl}/api/llm-providers/health`)
      ])
      
      console.log('📊 Response status:', {
        providers: providersResponse.status,
        config: configResponse.status,
        health: healthResponse.status
      })
      
      const providersData = await providersResponse.json()
      const configData = await configResponse.json()
      const healthData = await healthResponse.json()
      
      console.log('📦 Received data:', { providersData, configData, healthData })
      
      if (providersData.success) {
        setAvailableProviders(providersData.providers)
        console.log('✅ Set available providers:', providersData.providers)
      } else {
        console.error('❌ Failed to get providers:', providersData)
      }
      
      if (configData.success) {
        setCurrentConfig(configData.config)
        setSelectedPrimary(configData.config.primary_provider)
        setSelectedFallback(configData.config.fallback_provider)
        console.log('✅ Set config:', configData.config)
      } else {
        console.error('❌ Failed to get config:', configData)
      }
      
      if (healthData.success) {
        setProviderStatus(healthData)
        console.log('✅ Set health status:', healthData)
      } else {
        console.error('❌ Failed to get health:', healthData)
      }
      
    } catch (error) {
      console.error('❌ Error fetching provider data:', error)
      toast.error('Failed to fetch provider information. Check console for details.')
      
      // Set fallback data for development
      setAvailableProviders(['openai', 'anthropic'])
      setCurrentConfig({
        primary_provider: 'openai',
        fallback_provider: 'anthropic'
      })
      setSelectedPrimary('openai')
      setSelectedFallback('anthropic')
      
      console.log('🔧 Set fallback provider data for development')
    } finally {
      setIsLoading(false)
    }
  }

  const fetchProviderHealth = async () => {
    try {
      const pythonBackendUrl = process.env.NEXT_PUBLIC_AI_BACKEND_URL || 'http://localhost:8000'
      const response = await fetch(`${pythonBackendUrl}/api/llm-providers/health`)
      const data = await response.json()
      
      if (data.success) {
        setProviderStatus(data)
      }
    } catch (error) {
      console.error('Error fetching provider health:', error)
    }
  }

  const testProvider = async (provider: string) => {
    try {
      setIsTesting(provider)
      toast.loading(`Testing ${provider}...`, { id: `test-${provider}` })
      
      const pythonBackendUrl = process.env.NEXT_PUBLIC_AI_BACKEND_URL || 'http://localhost:8000'
      const response = await fetch(`${pythonBackendUrl}/api/llm-providers/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provider,
          test_prompt: 'Health check - please respond with: {"status": "ok"}'
        })
      })
      
      const data = await response.json()
      
      if (data.success) {
        toast.success(`${provider} test successful (${(data.response_time * 1000).toFixed(0)}ms)`, { 
          id: `test-${provider}` 
        })
      } else {
        toast.error(`${provider} test failed: ${data.error}`, { 
          id: `test-${provider}` 
        })
      }
      
      // Refresh health status
      setTimeout(fetchProviderHealth, 1000)
      
    } catch (error) {
      console.error(`Error testing ${provider}:`, error)
      toast.error(`Failed to test ${provider}`, { id: `test-${provider}` })
    } finally {
      setIsTesting(null)
    }
  }

  const configureProviders = async () => {
    try {
      setIsConfiguring(true)
      toast.loading('Updating provider configuration...', { id: 'configure' })
      
      const pythonBackendUrl = process.env.NEXT_PUBLIC_AI_BACKEND_URL || 'http://localhost:8000'
      const response = await fetch(`${pythonBackendUrl}/api/llm-providers/configure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          primary_provider: selectedPrimary,
          fallback_provider: selectedFallback
        })
      })
      
      const data = await response.json()
      
      if (data.success) {
        toast.success(data.message, { id: 'configure' })
        setCurrentConfig(data.config)
        
        // Refresh all data
        setTimeout(fetchProviderData, 1000)
      } else {
        toast.error(data.detail || 'Configuration failed', { id: 'configure' })
      }
      
    } catch (error) {
      console.error('Error configuring providers:', error)
      toast.error('Failed to update configuration', { id: 'configure' })
    } finally {
      setIsConfiguring(false)
    }
  }

  const getProviderDisplayName = (provider: string) => {
    const names: Record<string, string> = {
      'openai': 'OpenAI GPT-4',
      'anthropic': 'Anthropic Claude',
      'google': 'Google Gemini'
    }
    return names[provider] || provider
  }

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'openai': return '🤖'
      case 'anthropic': return '🔮'
      case 'google': return '🎯'
      default: return '⚡'
    }
  }

  const getHealthIcon = (health: ProviderHealth) => {
    if (health.healthy) {
      return <CheckCircle className="h-4 w-4 text-green-500" />
    } else {
      return <AlertCircle className="h-4 w-4 text-red-500" />
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            LLM Provider Manager
          </CardTitle>
          <CardDescription>
            Configure and monitor AI providers for snapshot processing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-10 bg-gray-200 rounded w-1/3"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          LLM Provider Manager
          {providerStatus && (
            <Badge variant={providerStatus.overall_health === 'healthy' ? 'default' : 'destructive'}>
              {providerStatus.overall_health}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Configure and monitor AI providers for snapshot processing (easily pluggable)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Configuration */}
        {currentConfig && (
          <div className="space-y-3">
            <h4 className="font-medium text-gray-900">Current Configuration</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 border rounded-lg bg-blue-50">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{getProviderIcon(currentConfig.primary_provider)}</span>
                  <span className="font-medium">Primary Provider</span>
                </div>
                <div className="text-sm text-gray-600">
                  {getProviderDisplayName(currentConfig.primary_provider)}
                </div>
                {providerStatus?.providers[currentConfig.primary_provider] && (
                  <div className="flex items-center gap-2 mt-2">
                    {getHealthIcon(providerStatus.providers[currentConfig.primary_provider])}
                    <span className="text-xs text-gray-500">
                      {(providerStatus.providers[currentConfig.primary_provider].response_time * 1000).toFixed(0)}ms
                    </span>
                  </div>
                )}
              </div>
              
              <div className="p-4 border rounded-lg bg-green-50">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{getProviderIcon(currentConfig.fallback_provider)}</span>
                  <span className="font-medium">Fallback Provider</span>
                </div>
                <div className="text-sm text-gray-600">
                  {getProviderDisplayName(currentConfig.fallback_provider)}
                </div>
                {providerStatus?.providers[currentConfig.fallback_provider] && (
                  <div className="flex items-center gap-2 mt-2">
                    {getHealthIcon(providerStatus.providers[currentConfig.fallback_provider])}
                    <span className="text-xs text-gray-500">
                      {(providerStatus.providers[currentConfig.fallback_provider].response_time * 1000).toFixed(0)}ms
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Provider Testing */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="font-medium text-gray-900">Available Providers</h4>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={fetchProviderData}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          
          <div className="space-y-2">
            {availableProviders.map((provider) => (
              <div key={provider} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{getProviderIcon(provider)}</span>
                  <div>
                    <div className="font-medium">{getProviderDisplayName(provider)}</div>
                    <div className="text-sm text-gray-500">{provider}</div>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  {providerStatus?.providers[provider] && (
                    <div className="flex items-center gap-2">
                      {getHealthIcon(providerStatus.providers[provider])}
                      <span className="text-xs text-gray-500">
                        {(providerStatus.providers[provider].response_time * 1000).toFixed(0)}ms
                      </span>
                    </div>
                  )}
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testProvider(provider)}
                    disabled={isTesting === provider}
                  >
                    {isTesting === provider ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      'Test'
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Configuration Panel */}
        <div className="space-y-4 pt-4 border-t">
          <h4 className="font-medium text-gray-900">Configure Providers</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Primary Provider</label>
              <select
                value={selectedPrimary}
                onChange={(e) => setSelectedPrimary(e.target.value)}
                className="w-full p-2 border rounded-md"
              >
                {availableProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {getProviderDisplayName(provider)}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Fallback Provider</label>
              <select
                value={selectedFallback}
                onChange={(e) => setSelectedFallback(e.target.value)}
                className="w-full p-2 border rounded-md"
              >
                {availableProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {getProviderDisplayName(provider)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-500">
              Changes apply immediately but won't persist across restarts
            </div>
            <Button
              onClick={configureProviders}
              disabled={isConfiguring || (selectedPrimary === currentConfig?.primary_provider && selectedFallback === currentConfig?.fallback_provider)}
            >
              {isConfiguring ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Settings className="h-4 w-4 mr-2" />
                  Update Configuration
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Help Text */}
        <div className="text-xs text-gray-500 space-y-1 pt-4 border-t">
          <p><strong>Provider Selection:</strong></p>
          <p>• <strong>OpenAI:</strong> Fast, cost-effective, excellent for most tasks</p>
          <p>• <strong>Anthropic:</strong> Superior accuracy for structured data extraction</p>
          <p>• Fallback provider is used automatically if primary fails</p>
          <p>• Test providers before switching to ensure they're working correctly</p>
        </div>
      </CardContent>
    </Card>
  )
}
