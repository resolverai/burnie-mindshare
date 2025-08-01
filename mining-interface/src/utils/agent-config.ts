/**
 * Agent Configuration Utilities
 * Handles local storage of sensitive data like API keys
 */

export interface LocalAgentConfig {
  walletAddress: string;
  provider: string;
  model: string;
  apiKey: string;
  createdAt: string;
}

/**
 * Store agent configuration locally (including API key)
 */
export function storeLocalAgentConfig(walletAddress: string, config: Omit<LocalAgentConfig, 'walletAddress' | 'createdAt'>): void {
  const agentConfig: LocalAgentConfig = {
    walletAddress,
    ...config,
    createdAt: new Date().toISOString()
  };
  
  localStorage.setItem(`burnie_agent_config_${walletAddress}`, JSON.stringify(agentConfig));
}

/**
 * Retrieve agent configuration from local storage
 */
export function getLocalAgentConfig(walletAddress: string): LocalAgentConfig | null {
  try {
    const stored = localStorage.getItem(`burnie_agent_config_${walletAddress}`);
    if (!stored) return null;
    
    return JSON.parse(stored) as LocalAgentConfig;
  } catch (error) {
    console.error('Error retrieving local agent config:', error);
    return null;
  }
}

/**
 * Get API key for content generation (never sent to backend)
 */
export function getAgentApiKey(walletAddress: string): string | null {
  const config = getLocalAgentConfig(walletAddress);
  return config?.apiKey || null;
}

/**
 * Check if agent has valid local configuration
 */
export function hasValidAgentConfig(walletAddress: string): boolean {
  const config = getLocalAgentConfig(walletAddress);
  return !!(config?.apiKey && config?.provider && config?.model);
}

/**
 * Clear local agent configuration (logout/reset)
 */
export function clearLocalAgentConfig(walletAddress: string): void {
  localStorage.removeItem(`burnie_agent_config_${walletAddress}`);
} 