// Use native fetch (Node.js 18+) or global fetch

// ROAST Token Contract Address on Base
const ROAST_TOKEN_ADDRESS = process.env.ROAST_TOKEN_CONTRACT || process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN || '0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4';

// Cache for price data
let priceCache: { price: number; timestamp: number } | null = null;
const CACHE_DURATION = 60000; // 1 minute cache

/**
 * Fetch ROAST token price in USD from DEXScreener
 */
export async function fetchROASTPrice(): Promise<number> {
  // Check cache first
  if (priceCache && Date.now() - priceCache.timestamp < CACHE_DURATION) {
    console.log(`Using cached ROAST price: $${priceCache.price} USD`);
    return priceCache.price;
  }

  console.log(`Fetching fresh ROAST price for token: ${ROAST_TOKEN_ADDRESS}`);

  try {
    // DEXScreener API (most reliable for new tokens)
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ROAST_TOKEN_ADDRESS}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Burnie-Backend/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`DEXScreener API error: ${response.status}`);
    }

    const data = await response.json() as any;
    
    if (data.pairs && data.pairs.length > 0) {
      // Get the pair with highest liquidity on Base network
      const basePairs = data.pairs.filter((pair: any) => 
        pair.chainId === 'base' || pair.chainId === '8453'
      );
      
      if (basePairs.length > 0) {
        // Sort by liquidity and get the best pair
        const bestPair = basePairs.reduce((prev: any, current: any) => {
          const prevLiq = parseFloat(prev.liquidity?.usd || '0');
          const currLiq = parseFloat(current.liquidity?.usd || '0');
          return currLiq > prevLiq ? current : prev;
        });
        
        const price = parseFloat(bestPair.priceUsd);
        if (price > 0) {
          priceCache = { price, timestamp: Date.now() };
          console.log(`✅ ROAST price updated: $${price} USD (from ${bestPair.dexId})`);
          return price;
        }
      } else {
        // If no Base pairs, try any available pair
        const anyPair = data.pairs[0];
        if (anyPair?.priceUsd) {
          const price = parseFloat(anyPair.priceUsd);
          if (price > 0) {
            priceCache = { price, timestamp: Date.now() };
            console.log(`✅ ROAST price updated (non-Base): $${price} USD`);
            return price;
          }
        }
      }
    }

    throw new Error('No valid price data found');
  } catch (error) {
    console.error('❌ Error fetching ROAST price:', error);
    
    // Return fallback price
    const fallbackPrice = 0.01;
    console.warn(`⚠️ Using fallback ROAST price: $${fallbackPrice} USD`);
    return fallbackPrice;
  }
}

/**
 * Convert USD amount to ROAST equivalent
 */
export async function convertUSDToROAST(usdAmount: number): Promise<number> {
  const roastPrice = await fetchROASTPrice();
  if (roastPrice <= 0) {
    throw new Error('Invalid ROAST price for conversion');
  }
  return usdAmount / roastPrice;
}

/**
 * Convert ROAST amount to USD equivalent
 */
export async function convertROASTToUSD(roastAmount: number): Promise<number> {
  const roastPrice = await fetchROASTPrice();
  return roastAmount * roastPrice;
} 