/**
 * API Key Management Utilities
 * Handles secure local storage of LLM provider API keys
 */

export interface ApiKeyConfig {
  openai?: string;
  anthropic?: string;
  google?: string;
  xai?: string;
  replicate?: string;
  elevenlabs?: string;
  stability?: string;
  fal?: string;
  updatedAt: string;
  walletAddress: string;
}

export interface ContentTypeModelPreferences {
  text: {
    provider: string;
    model: string;
  };
  image: {
    provider: string;
    model: string;
  };
  video: {
    provider: string;
    model: string;
  };
  audio: {
    provider: string;
    model: string;
  };
}

/**
 * Save API keys to localStorage (wallet-specific)
 */
export function saveApiKeys(walletAddress: string, apiKeys: Partial<Omit<ApiKeyConfig, 'updatedAt' | 'walletAddress'>>): void {
  const existing = getApiKeys(walletAddress) || {} as ApiKeyConfig;
  
  const config: ApiKeyConfig = {
    ...existing,
    ...apiKeys,
    walletAddress,
    updatedAt: new Date().toISOString()
  };
  
  localStorage.setItem(`burnie_api_keys_${walletAddress}`, JSON.stringify(config));
}

/**
 * Get API keys from localStorage
 */
export function getApiKeys(walletAddress: string): ApiKeyConfig | null {
  try {
    const stored = localStorage.getItem(`burnie_api_keys_${walletAddress}`);
    if (!stored) return null;
    
    return JSON.parse(stored) as ApiKeyConfig;
  } catch (error) {
    console.error('Error retrieving API keys:', error);
    return null;
  }
}

/**
 * Get specific API key for a provider
 */
export function getApiKey(walletAddress: string, provider: string): string | null {
  const config = getApiKeys(walletAddress);
  if (!config) return null;
  
  switch (provider.toLowerCase()) {
    case 'openai':
      return config.openai || null;
    case 'anthropic':
      return config.anthropic || null;
    case 'google':
      return config.google || null;
    case 'xai':
      return config.xai || null;
    case 'replicate':
      return config.replicate || null;
    case 'elevenlabs':
      return config.elevenlabs || null;
    case 'stability':
      return config.stability || null;
    case 'fal':
      return config.fal || null;
    default:
      return null;
  }
}

/**
 * Check if user has required API keys for content generation
 */
export function hasRequiredApiKeys(walletAddress: string, preferences: ContentTypeModelPreferences): boolean {
  const config = getApiKeys(walletAddress);
  if (!config) return false;
  
  const requiredProviders = Array.from(new Set([
    preferences.text.provider,
    preferences.image.provider,
    preferences.video.provider,
    preferences.audio.provider
  ]));
  
  // All providers now require API keys (no mock providers)
  for (const provider of requiredProviders) {
    if (!getApiKey(walletAddress, provider)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Clear all API keys for a wallet
 */
export function clearApiKeys(walletAddress: string): void {
  localStorage.removeItem(`burnie_api_keys_${walletAddress}`);
}

/**
 * Get available providers with API keys
 */
export function getAvailableProviders(walletAddress: string): string[] {
  const config = getApiKeys(walletAddress);
  if (!config) return [];
  
  const providers: string[] = []; // No mock provider - only real ones
  
  if (config.openai) providers.push('openai');
  if (config.anthropic) providers.push('anthropic');
  if (config.google) providers.push('google');
  if (config.xai) providers.push('xai');
  if (config.replicate) providers.push('replicate');
  if (config.elevenlabs) providers.push('elevenlabs');
  if (config.stability) providers.push('stability');
  if (config.fal) providers.push('fal');
  
  return providers;
}

/**
 * Validate API keys for agent model preferences
 */
export function validateAgentApiKeys(walletAddress: string, modelPreferences: ContentTypeModelPreferences): {
  isValid: boolean;
  missingKeys: string[];
  warnings: string[];
} {
  const config = getApiKeys(walletAddress);
  if (!config) {
    return {
      isValid: false,
      missingKeys: ['All API keys'],
      warnings: []
    };
  }
  
  const providerKeyMap = {
    'openai': 'openai',
    'anthropic': 'anthropic',
    'google': 'google',
    'xai': 'xai',
    'replicate': 'replicate',
    'elevenlabs': 'elevenlabs',
    'stability': 'stability',
    'fal': 'fal'
  };
  
  const requiredProviders = [
    { provider: modelPreferences.text?.provider, type: 'Text', required: true },
    { provider: modelPreferences.image?.provider, type: 'Image', required: false },
    { provider: modelPreferences.video?.provider, type: 'Video', required: false },
    { provider: modelPreferences.audio?.provider, type: 'Audio', required: false }
  ];
  
  const missingKeys: string[] = [];
  const warnings: string[] = [];
  
  for (const { provider, type, required } of requiredProviders) {
    if (!provider) continue;
    
    const keyName = providerKeyMap[provider as keyof typeof providerKeyMap];
    const hasKey = keyName && config[keyName as keyof ApiKeyConfig] && config[keyName as keyof ApiKeyConfig]?.trim();
    
    if (!hasKey) {
      if (required) {
        missingKeys.push(`${type} (${provider})`);
      } else {
        warnings.push(`${type} (${provider}) - will skip ${type} generation`);
      }
    }
  }
  
  return {
    isValid: missingKeys.length === 0,
    missingKeys,
    warnings
  };
} 