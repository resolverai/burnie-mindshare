import OpenAI from 'openai';

// Types for different content generation
export interface ContentGenerationRequest {
  prompt: string;
  contentType: 'text' | 'image' | 'video' | 'audio';
  model?: string;
  agentPersonality?: 'SAVAGE' | 'WITTY' | 'CHAOTIC' | 'LEGENDARY';
  brandAlignment?: string;
  targetAudience?: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
    style?: string;
    quality?: 'standard' | 'hd' | '4k';
    duration?: number; // for video/audio
    voice?: string; // for audio
  };
}

export interface ContentGenerationResponse {
  content: string; // URL for media, text for text
  contentType: 'text' | 'image' | 'video' | 'audio';
  provider: string;
  model: string;
  metadata: {
    tokensUsed?: number;
    duration?: number;
    fileSize?: number;
    cost?: number;
    qualityScore?: number;
    brandAlignmentScore?: number;
  };
}

export interface AIProvider {
  name: string;
  supportedTypes: ('text' | 'image' | 'video' | 'audio')[];
  generateContent(request: ContentGenerationRequest, apiKey: string): Promise<ContentGenerationResponse>;
  isConfigured(apiKey: string): boolean;
  calculateCost(contentType: string, usage: number): number;
}

// Enhanced OpenAI Provider
export class OpenAIProvider implements AIProvider {
  name = 'OpenAI';
  supportedTypes: ('text' | 'image' | 'video' | 'audio')[] = ['text', 'image', 'audio'];

  isConfigured(apiKey: string): boolean {
    return !!apiKey && apiKey.length > 10;
  }

  calculateCost(contentType: string, usage: number): number {
    switch (contentType) {
      case 'text':
        return (usage / 1000) * 0.01; // $0.01 per 1K tokens (GPT-4 estimate)
      case 'image':
        return usage * 0.04; // $0.04 per image (DALL-E 3)
      case 'audio':
        return (usage / 1000) * 0.015; // $0.015 per 1K characters (TTS)
      default:
        return 0;
    }
  }

  private enhancePromptWithPersonality(prompt: string, personality?: string, brandAlignment?: string): string {
    let enhancedPrompt = prompt;
    
    if (personality) {
      const personalityMap = {
        'SAVAGE': 'Write in a bold, edgy, and provocative style that cuts through the noise. Be direct and impactful.',
        'WITTY': 'Use clever wordplay, humor, and intelligent observations. Be entertaining while staying informative.',
        'CHAOTIC': 'Be unpredictable, creative, and unconventional. Break traditional patterns while staying engaging.',
        'LEGENDARY': 'Write with authority, confidence, and timeless appeal. Create content that feels iconic and memorable.'
      };
      enhancedPrompt = `${personalityMap[personality as keyof typeof personalityMap]}\n\n${prompt}`;
    }

    if (brandAlignment) {
      enhancedPrompt = `Brand Context: ${brandAlignment}\n\n${enhancedPrompt}`;
    }

    return enhancedPrompt;
  }

  async generateContent(request: ContentGenerationRequest, apiKey: string): Promise<ContentGenerationResponse> {
    const openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
    const enhancedPrompt = this.enhancePromptWithPersonality(
      request.prompt, 
      request.agentPersonality, 
      request.brandAlignment
    );

    try {
      switch (request.contentType) {
        case 'text':
          const completion = await openai.chat.completions.create({
            model: request.model || 'gpt-4-turbo-preview',
            messages: [{ role: 'user', content: enhancedPrompt }],
            max_tokens: request.options?.maxTokens || 500,
            temperature: request.options?.temperature || 0.7,
          });

          const content = completion.choices[0]?.message?.content || '';
          const tokensUsed = completion.usage?.total_tokens || 0;

          return {
            content,
            contentType: 'text',
            provider: 'OpenAI',
            model: request.model || 'gpt-4-turbo-preview',
            metadata: {
              tokensUsed,
              cost: this.calculateCost('text', tokensUsed),
              qualityScore: this.calculateQualityScore(content),
              brandAlignmentScore: request.brandAlignment ? this.calculateBrandAlignment(content, request.brandAlignment) : undefined,
            },
          };

        case 'image':
          const imageResponse = await openai.images.generate({
            model: 'dall-e-3',
            prompt: enhancedPrompt,
            size: request.options?.quality === 'hd' ? '1792x1024' : '1024x1024',
            quality: request.options?.quality === 'hd' ? 'hd' : 'standard',
            n: 1,
          });

          return {
            content: imageResponse.data[0]?.url || '',
            contentType: 'image',
            provider: 'OpenAI',
            model: 'dall-e-3',
            metadata: {
              cost: this.calculateCost('image', 1),
              qualityScore: 0.85, // Default score for DALL-E
            },
          };

        case 'audio':
          const audioResponse = await openai.audio.speech.create({
            model: 'tts-1-hd',
            voice: (request.options?.voice as any) || 'nova',
            input: enhancedPrompt,
          });

          const audioBlob = await audioResponse.blob();
          const audioUrl = URL.createObjectURL(audioBlob);

          return {
            content: audioUrl,
            contentType: 'audio',
            provider: 'OpenAI',
            model: 'tts-1-hd',
            metadata: {
              duration: Math.ceil(enhancedPrompt.length / 15), // Estimate 15 chars per second
              fileSize: audioBlob.size,
              cost: this.calculateCost('audio', enhancedPrompt.length),
              qualityScore: 0.9, // High quality for TTS
            },
          };

        default:
          throw new Error(`Unsupported content type: ${request.contentType}`);
      }
    } catch (error: any) {
      console.error('OpenAI generation error:', error);
      throw new Error(`OpenAI generation failed: ${error.message}`);
    }
  }

  private calculateQualityScore(content: string): number {
    // Simple quality scoring based on content characteristics
    let score = 0.5; // Base score
    
    // Length bonus (optimal length)
    if (content.length > 50 && content.length < 1000) score += 0.2;
    
    // Sentence structure
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 1 && sentences.length < 10) score += 0.1;
    
    // Vocabulary diversity
    const words = content.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);
    const diversity = uniqueWords.size / words.length;
    if (diversity > 0.7) score += 0.2;
    
    return Math.min(1.0, score);
  }

  private calculateBrandAlignment(content: string, brandContext: string): number {
    // Simple brand alignment scoring (in production, this would use more sophisticated NLP)
    const brandKeywords = brandContext.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    
    let alignmentScore = 0;
    brandKeywords.forEach(keyword => {
      if (contentLower.includes(keyword)) {
        alignmentScore += 0.1;
      }
    });
    
    return Math.min(1.0, alignmentScore);
  }
}

// Enhanced Anthropic Provider
export class AnthropicProvider implements AIProvider {
  name = 'Anthropic';
  supportedTypes: ('text' | 'image' | 'video' | 'audio')[] = ['text'];

  isConfigured(apiKey: string): boolean {
    return !!apiKey && apiKey.length > 10;
  }

  calculateCost(contentType: string, usage: number): number {
    switch (contentType) {
      case 'text':
        return (usage / 1000) * 0.015; // $0.015 per 1K tokens (Claude-3 estimate)
      default:
        return 0;
    }
  }

  async generateContent(request: ContentGenerationRequest, apiKey: string): Promise<ContentGenerationResponse> {
    if (request.contentType !== 'text') {
      throw new Error('Anthropic provider only supports text generation');
    }

    try {
      const enhancedPrompt = this.enhancePromptWithPersonality(
        request.prompt, 
        request.agentPersonality, 
        request.brandAlignment
      );

      // Use fetch API for Anthropic since SDK has issues in browser
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.model || 'claude-3-5-sonnet-20241022',
          max_tokens: request.options?.maxTokens || 500,
          temperature: request.options?.temperature || 0.7,
          messages: [{ role: 'user', content: enhancedPrompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || '';
      const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

          return {
        content,
            contentType: 'text',
        provider: 'Anthropic',
        model: request.model || 'claude-3-5-sonnet-20241022',
            metadata: {
          tokensUsed,
          cost: this.calculateCost('text', tokensUsed),
          qualityScore: this.calculateQualityScore(content),
          brandAlignmentScore: request.brandAlignment ? this.calculateBrandAlignment(content, request.brandAlignment) : undefined,
        },
      };
    } catch (error: any) {
      console.error('Anthropic generation error:', error);
      throw new Error(`Anthropic generation failed: ${error.message}`);
    }
  }

  private enhancePromptWithPersonality(prompt: string, personality?: string, brandAlignment?: string): string {
    let enhancedPrompt = prompt;
    
    if (personality) {
      const personalityMap = {
        'SAVAGE': 'Channel a bold, uncompromising voice that challenges conventions and speaks truth to power. Be fearless and impactful.',
        'WITTY': 'Employ sharp wit, clever insights, and sophisticated humor. Balance entertainment with substance.',
        'CHAOTIC': 'Embrace creative unpredictability and unconventional thinking. Break patterns while maintaining coherence.',
        'LEGENDARY': 'Write with gravitas and enduring wisdom. Create content that resonates across time and audiences.'
      };
      enhancedPrompt = `Voice Direction: ${personalityMap[personality as keyof typeof personalityMap]}\n\n${prompt}`;
    }

    if (brandAlignment) {
      enhancedPrompt = `Brand Guidelines: ${brandAlignment}\n\n${enhancedPrompt}`;
    }

    return enhancedPrompt;
  }

  private calculateQualityScore(content: string): number {
    // Claude-specific quality scoring
    let score = 0.6; // Higher base score for Claude
    
    // Depth and nuance
    if (content.includes('however') || content.includes('moreover') || content.includes('furthermore')) score += 0.1;
    
    // Balanced perspective
    if (content.includes('while') || content.includes('although') || content.includes('despite')) score += 0.1;
    
    // Sophisticated vocabulary
    const sophisticatedWords = ['nuanced', 'paradigm', 'leverage', 'synthesize', 'optimize', 'strategic'];
    sophisticatedWords.forEach(word => {
      if (content.toLowerCase().includes(word)) score += 0.05;
    });
    
    return Math.min(1.0, score);
  }

  private calculateBrandAlignment(content: string, brandContext: string): number {
    // Enhanced brand alignment for Claude
    const brandKeywords = brandContext.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    
    let alignmentScore = 0;
    brandKeywords.forEach(keyword => {
      if (contentLower.includes(keyword)) {
        alignmentScore += 0.15; // Higher weight for Claude
      }
    });
    
    return Math.min(1.0, alignmentScore);
  }
}

// New Google Gemini Provider
export class GeminiProvider implements AIProvider {
  name = 'Google Gemini';
  supportedTypes: ('text' | 'image' | 'video' | 'audio')[] = ['text', 'image'];

  isConfigured(apiKey: string): boolean {
    return !!apiKey && apiKey.length > 10;
  }

  calculateCost(contentType: string, usage: number): number {
    switch (contentType) {
      case 'text':
        return (usage / 1000) * 0.0005; // $0.0005 per 1K tokens (Gemini Pro estimate)
      case 'image':
        return usage * 0.002; // $0.002 per image analysis
      default:
        return 0;
    }
  }

  async generateContent(request: ContentGenerationRequest, apiKey: string): Promise<ContentGenerationResponse> {
    try {
      const enhancedPrompt = this.enhancePromptWithPersonality(
        request.prompt, 
        request.agentPersonality, 
        request.brandAlignment
      );

      if (request.contentType === 'text') {
        // Use fetch API for Gemini for better browser compatibility
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${request.model || 'gemini-pro'}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ 
              parts: [{ text: enhancedPrompt }] 
            }],
            generationConfig: {
              temperature: request.options?.temperature || 0.7,
              maxOutputTokens: request.options?.maxTokens || 500,
                  },
          }),
        });

        if (!response.ok) {
          throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const tokensUsed = data.usageMetadata?.totalTokenCount || 0;

            return {
          content,
          contentType: 'text',
          provider: 'Google Gemini',
          model: request.model || 'gemini-pro',
              metadata: {
            tokensUsed,
            cost: this.calculateCost('text', tokensUsed),
            qualityScore: this.calculateQualityScore(content),
            brandAlignmentScore: request.brandAlignment ? this.calculateBrandAlignment(content, request.brandAlignment) : undefined,
              },
            };
      } else {
        throw new Error(`Gemini provider currently only supports text generation`);
      }
    } catch (error: any) {
      console.error('Gemini generation error:', error);
      throw new Error(`Gemini generation failed: ${error.message}`);
    }
  }

  private enhancePromptWithPersonality(prompt: string, personality?: string, brandAlignment?: string): string {
    let enhancedPrompt = prompt;
    
    if (personality) {
      const personalityMap = {
        'SAVAGE': 'Adopt a fierce, uncompromising tone that cuts through noise. Be bold and direct.',
        'WITTY': 'Use intelligent humor and clever observations. Be engaging and memorable.',
        'CHAOTIC': 'Embrace creative chaos and unexpected connections. Be innovative and surprising.',
        'LEGENDARY': 'Write with timeless authority and profound insight. Create lasting impact.'
      };
      enhancedPrompt = `Style: ${personalityMap[personality as keyof typeof personalityMap]}\n\n${prompt}`;
      }

    if (brandAlignment) {
      enhancedPrompt = `Brand Context: ${brandAlignment}\n\n${enhancedPrompt}`;
    }

    return enhancedPrompt;
  }

  private calculateQualityScore(content: string): number {
    // Gemini-specific quality scoring
    let score = 0.55; // Base score for Gemini
    
    // Innovation and creativity
    const creativeWords = ['innovative', 'revolutionary', 'breakthrough', 'cutting-edge', 'pioneering'];
    creativeWords.forEach(word => {
      if (content.toLowerCase().includes(word)) score += 0.1;
    });
    
    // Technical accuracy (Gemini is good at this)
    if (content.includes('data') || content.includes('research') || content.includes('evidence')) score += 0.15;
    
    return Math.min(1.0, score);
  }

  private calculateBrandAlignment(content: string, brandContext: string): number {
    const brandKeywords = brandContext.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    
    let alignmentScore = 0;
    brandKeywords.forEach(keyword => {
      if (contentLower.includes(keyword)) {
        alignmentScore += 0.12;
      }
    });
    
    return Math.min(1.0, alignmentScore);
  }
}

// Enhanced Mock Provider for testing
export class MockProvider implements AIProvider {
  name = 'Mock Provider';
  supportedTypes: ('text' | 'image' | 'video' | 'audio')[] = ['text', 'image', 'audio', 'video'];

  isConfigured(apiKey: string): boolean {
    return true; // Always available for testing
  }

  calculateCost(contentType: string, usage: number): number {
    return 0; // Free for testing
  }

  async generateContent(request: ContentGenerationRequest): Promise<ContentGenerationResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    const personalityTemplates = {
      'SAVAGE': [
        "🔥 BREAKING: This {topic} is about to get absolutely demolished. No mercy, no prisoners.",
        "⚡ HOT TAKE: {topic} just got served a reality check that hits harder than a freight train.",
        "💥 SAVAGE TRUTH: {topic} is the kind of chaos that separates winners from wishful thinkers."
      ],
      'WITTY': [
        "🧠 Plot twist: {topic} just became the smartest thing you'll see today. *chef's kiss*",
        "✨ Fun fact: {topic} is proof that intelligence and entertainment can actually coexist.",
        "🎯 Breaking news: {topic} just made everyone else look like they're playing checkers while we're playing 4D chess."
      ],
      'CHAOTIC': [
        "🌪️ CHAOS ENERGY: {topic} just entered the chat and all bets are off.",
        "🎪 WILD CARD: {topic} is the kind of beautiful madness that breaks the internet.",
        "🚀 RANDOM GREATNESS: {topic} just launched us into a dimension where normal rules don't apply."
      ],
      'LEGENDARY': [
        "👑 LEGENDARY STATUS: {topic} just carved its name into the halls of greatness.",
        "🏛️ ICONIC MOMENT: {topic} is the kind of excellence that future generations will study.",
        "⭐ TIMELESS TRUTH: {topic} represents the pinnacle of what's possible when vision meets execution."
      ]
    };

    const personality = request.agentPersonality || 'WITTY';
    const templates = personalityTemplates[personality];
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    // Extract topic from prompt or use generic
    const topic = request.prompt.split(' ').slice(0, 3).join(' ') || 'innovation';
    
    let content = template.replace('{topic}', topic);
    
    // Add brand alignment if provided
    if (request.brandAlignment) {
      content += `\n\n🎯 ${request.brandAlignment} vibes are strong with this one.`;
    }

    // Extend content based on prompt
    content += `\n\n${request.prompt} - but make it ${personality.toLowerCase()}.`;

    return {
      content,
      contentType: request.contentType,
      provider: 'Mock Provider',
      model: request.model || `mock-${request.contentType}-model`,
      metadata: {
        tokensUsed: Math.floor(Math.random() * 200) + 50,
        cost: 0,
        qualityScore: 0.7 + Math.random() * 0.3,
        brandAlignmentScore: request.brandAlignment ? 0.8 + Math.random() * 0.2 : undefined,
      },
    };
  }
}

// AI Provider Manager with enhanced capabilities
export class AIProviderManager {
  private providers: Map<string, AIProvider> = new Map();

  constructor() {
    this.registerProvider('openai', new OpenAIProvider());
    this.registerProvider('anthropic', new AnthropicProvider());
    this.registerProvider('gemini', new GeminiProvider());
    this.registerProvider('mock', new MockProvider());
  }

  registerProvider(name: string, provider: AIProvider): void {
    this.providers.set(name.toLowerCase(), provider);
  }

  getProvider(name: string): AIProvider | undefined {
    return this.providers.get(name.toLowerCase());
  }

  getProvidersForContentType(contentType: string): AIProvider[] {
    return Array.from(this.providers.values()).filter(provider =>
      provider.supportedTypes.includes(contentType as any)
    );
  }

  getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  async generateContent(
    providerName: string,
    request: ContentGenerationRequest,
    apiKey: string
  ): Promise<ContentGenerationResponse> {
    const provider = this.getProvider(providerName);
    if (!provider) {
      throw new Error(`Provider "${providerName}" not found`);
    }

    if (!provider.isConfigured(apiKey) && providerName !== 'mock') {
      throw new Error(`Provider "${providerName}" is not properly configured`);
    }

    if (!provider.supportedTypes.includes(request.contentType)) {
      throw new Error(`Provider "${providerName}" does not support content type "${request.contentType}"`);
    }

    return provider.generateContent(request, apiKey);
  }

  // Batch generation for team collaboration
  async generateBatchContent(
    requests: Array<{providerName: string, request: ContentGenerationRequest, apiKey: string}>
  ): Promise<ContentGenerationResponse[]> {
    const promises = requests.map(({ providerName, request, apiKey }) =>
      this.generateContent(providerName, request, apiKey).catch(error => ({
        content: `Error: ${error.message}`,
        contentType: request.contentType,
        provider: providerName,
        model: 'error',
        metadata: { cost: 0, tokensUsed: 0, qualityScore: 0 }
      }))
    );

    return Promise.all(promises);
  }

  // Get optimal provider for request
  getOptimalProvider(request: ContentGenerationRequest, availableKeys: Record<string, string>): string {
    const supportedProviders = this.getProvidersForContentType(request.contentType);
    
    // Priority order based on content type and quality
    const priorities = {
      'text': ['anthropic', 'openai', 'gemini', 'mock'],
      'image': ['openai', 'gemini', 'mock'],
      'audio': ['openai', 'mock'],
      'video': ['mock'] // Future: add video providers
    };

    const priorityList = priorities[request.contentType] || ['mock'];
    
    for (const providerName of priorityList) {
      const provider = this.getProvider(providerName);
      if (provider && provider.supportedTypes.includes(request.contentType)) {
        if (providerName === 'mock' || provider.isConfigured(availableKeys[providerName])) {
          return providerName;
        }
      }
    }

    return 'mock'; // Fallback
  }
}

// Export singleton instance
export const aiProviderManager = new AIProviderManager(); 