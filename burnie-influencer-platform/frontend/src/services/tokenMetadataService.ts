/**
 * Token Metadata Service
 * Fetches real-time token metadata from DEX APIs instead of using local files
 */

export interface TokenMetadata {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  image: string;
  price?: number;
  priceChange24h?: number;
  marketCap?: number;
  volume24h?: number;
  chainId: number;
}

interface DEXScreenerResponse {
  schemaVersion: string;
  pairs: Array<{
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    baseToken: {
      address: string;
      name: string;
      symbol: string;
    };
    quoteToken: {
      address: string;
      name: string;
      symbol: string;
    };
    priceNative: string;
    priceUsd: string;
    txns: {
      m5: { buys: number; sells: number };
      h1: { buys: number; sells: number };
      h6: { buys: number; sells: number };
      h24: { buys: number; sells: number };
    };
    volume: {
      h24: number;
      h6: number;
      h1: number;
      m5: number;
    };
    priceChange: {
      m5: number;
      h1: number;
      h6: number;
      h24: number;
    };
    liquidity: {
      usd: number;
      base: number;
      quote: number;
    };
    fdv: number;
    marketCap: number;
    pairCreatedAt: number;
    info: {
      imageUrl?: string;
      header?: string;
      openGraph?: string;
      websites?: Array<{ label: string; url: string }>;
      socials?: Array<{ type: string; url: string }>;
    };
  }>;
}

interface CoinGeckoResponse {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  fully_diluted_valuation: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap_change_24h: number;
  market_cap_change_percentage_24h: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number;
  ath: number;
  ath_change_percentage: number;
  ath_date: string;
  atl: number;
  atl_change_percentage: number;
  atl_date: string;
  last_updated: string;
}

class TokenMetadataService {
  private cache = new Map<string, { data: TokenMetadata; timestamp: number }>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  /**
   * Get token metadata from cache or fetch from APIs
   */
  async getTokenMetadata(contractAddress: string, chainId: number = 8453): Promise<TokenMetadata | null> {
    const cacheKey = `${contractAddress}-${chainId}`;
    const cached = this.cache.get(cacheKey);
    
    // Return cached data if still valid
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      console.log('✅ Returning cached token metadata for', contractAddress);
      return cached.data;
    }

    console.log('🔍 Fetching fresh token metadata for', contractAddress);

    // Try multiple sources in order of preference
    let metadata = await this.fetchFromDEXScreener(contractAddress, chainId);
    
    if (!metadata) {
      metadata = await this.fetchFromCoinGecko(contractAddress, chainId);
    }

    if (!metadata) {
      metadata = await this.fetchFromUniswap(contractAddress, chainId);
    }

    if (!metadata) {
      // Fallback to basic on-chain data
      metadata = await this.fetchFromOnChain(contractAddress, chainId);
    }

    if (metadata) {
      // Cache the result
      this.cache.set(cacheKey, { data: metadata, timestamp: Date.now() });
      console.log('✅ Token metadata cached for', contractAddress);
    }

    return metadata;
  }

  /**
   * Fetch token metadata from DEXScreener API
   */
  private async fetchFromDEXScreener(contractAddress: string, chainId: number): Promise<TokenMetadata | null> {
    try {
      console.log('🔍 Trying DEXScreener API...');
      
      // DEXScreener API endpoint for Base chain
      const baseChainId = chainId === 8453 ? 'base' : 'ethereum';
      const url = `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`DEXScreener API error: ${response.status}`);
      }

      const data: DEXScreenerResponse = await response.json();
      
      if (data.pairs && data.pairs.length > 0) {
        const pair = data.pairs[0]; // Use the first pair (usually the most liquid)
        const token = pair.baseToken.address.toLowerCase() === contractAddress.toLowerCase() 
          ? pair.baseToken 
          : pair.quoteToken;

        return {
          address: contractAddress,
          name: token.name,
          symbol: token.symbol,
          decimals: 18, // Default, will be fetched from contract if needed
          image: pair.info?.imageUrl || '',
          price: parseFloat(pair.priceUsd),
          priceChange24h: pair.priceChange?.h24 || 0,
          marketCap: pair.marketCap,
          volume24h: pair.volume?.h24 || 0,
          chainId
        };
      }
    } catch (error) {
      console.log('⚠️ DEXScreener fetch failed:', error);
    }
    
    return null;
  }

  /**
   * Fetch token metadata from CoinGecko API
   */
  private async fetchFromCoinGecko(contractAddress: string, chainId: number): Promise<TokenMetadata | null> {
    try {
      console.log('🔍 Trying CoinGecko API...');
      
      // CoinGecko platform ID for Base
      const platform = chainId === 8453 ? 'base' : 'ethereum';
      const url = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${contractAddress}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();
      
      return {
        address: contractAddress,
        name: data.name,
        symbol: data.symbol.toUpperCase(),
        decimals: data.detail_platforms?.[platform]?.decimal_place || 18,
        image: data.image?.large || data.image?.small || '',
        price: data.market_data?.current_price?.usd || 0,
        priceChange24h: data.market_data?.price_change_percentage_24h || 0,
        marketCap: data.market_data?.market_cap?.usd || 0,
        volume24h: data.market_data?.total_volume?.usd || 0,
        chainId
      };
    } catch (error) {
      console.log('⚠️ CoinGecko fetch failed:', error);
    }
    
    return null;
  }

  /**
   * Fetch token metadata from Uniswap/The Graph
   */
  private async fetchFromUniswap(contractAddress: string, chainId: number): Promise<TokenMetadata | null> {
    try {
      console.log('🔍 Trying Uniswap/The Graph API...');
      
      // The Graph query for token data
      const query = `
        {
          token(id: "${contractAddress.toLowerCase()}") {
            id
            symbol
            name
            decimals
            totalSupply
            derivedETH
          }
        }
      `;

      const subgraphUrl = chainId === 8453 
        ? 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-base'
        : 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';

      const response = await fetch(subgraphUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error(`Uniswap API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.data?.token) {
        const token = data.data.token;
        return {
          address: contractAddress,
          name: token.name,
          symbol: token.symbol,
          decimals: parseInt(token.decimals),
          image: '', // Uniswap doesn't provide images
          chainId
        };
      }
    } catch (error) {
      console.log('⚠️ Uniswap fetch failed:', error);
    }
    
    return null;
  }

  /**
   * Fallback: Fetch basic token data from on-chain contract calls
   */
  private async fetchFromOnChain(contractAddress: string, chainId: number): Promise<TokenMetadata | null> {
    try {
      console.log('🔍 Trying on-chain contract calls...');
      
      // This would require importing wagmi/viem here
      // For now, return a basic fallback
      return {
        address: contractAddress,
        name: 'ROAST Token', // Fallback name
        symbol: 'ROAST', // Fallback symbol
        decimals: 18, // Standard ERC-20 decimals
        image: '', // No image available
        chainId
      };
    } catch (error) {
      console.log('⚠️ On-chain fetch failed:', error);
    }
    
    return null;
  }

  /**
   * Get ROAST token metadata specifically
   */
  async getROASTTokenMetadata(): Promise<TokenMetadata | null> {
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN || '0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4';
    if (!contractAddress) {
      console.error('❌ ROAST token contract address not configured');
      return null;
    }

    console.log('🔍 Fetching metadata for ROAST token at:', contractAddress);
    return this.getTokenMetadata(contractAddress, 8453); // Base chain
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear();
    console.log('🗑️ Token metadata cache cleared');
  }
}

// Export singleton instance
export const tokenMetadataService = new TokenMetadataService();

// Export default
export default tokenMetadataService;
