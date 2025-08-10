import { useState, useEffect } from 'react'

// ROAST Token Contract Address on Base
export const ROAST_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN || process.env.NEXT_PUBLIC_ROAST_TOKEN_ADDRESS || '0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4'

// Debug: Log the token address being used
console.log('🔥 ROAST Token Address:', ROAST_TOKEN_ADDRESS)
console.log('📊 Environment:', process.env.NODE_ENV)

// Validate token address format
const isValidTokenAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

if (!isValidTokenAddress(ROAST_TOKEN_ADDRESS)) {
  console.error('❌ Invalid ROAST token address format:', ROAST_TOKEN_ADDRESS)
} else {
  console.log('✅ Valid ROAST token address format')
}

// Cache for price data
let priceCache: { price: number; timestamp: number } | null = null
const CACHE_DURATION = 60000 // 1 minute cache

// Fetch ROAST token price in USD
export async function fetchROASTPrice(): Promise<number> {
  // Check cache first
  if (priceCache && Date.now() - priceCache.timestamp < CACHE_DURATION) {
    console.log(`Using cached ROAST price: $${priceCache.price} USD`)
    return priceCache.price
  }

  console.log(`Fetching fresh ROAST price for token: ${ROAST_TOKEN_ADDRESS}`)

  try {
    // Try multiple DEX APIs for best price coverage
    const pricePromises = [
      // DEXScreener API (most reliable for new tokens)
      fetchFromDEXScreener(),
      // Uniswap V3 on Base
      fetchFromUniswap(),
      // Fallback to CoinGecko (if ROAST is listed)
      fetchFromCoinGecko(),
    ]

    const prices = await Promise.allSettled(pricePromises)
    
    // Log all results for debugging
    prices.forEach((result, index) => {
      const sources = ['DEXScreener', 'Uniswap', 'CoinGecko']
      if (result.status === 'fulfilled') {
        console.log(`${sources[index]} price: $${result.value} USD`)
      } else {
        console.log(`${sources[index]} failed:`, result.reason?.message)
      }
    })
    
    // Get the first successful price
    for (const result of prices) {
      if (result.status === 'fulfilled' && result.value > 0) {
        const price = result.value
        priceCache = { price, timestamp: Date.now() }
        console.log(`✅ ROAST price updated: $${price} USD`)
        return price
      }
    }

    // If all fail, return a fallback price (you can set this based on your token's typical range)
    const fallbackPrice = 0.01
    console.warn(`⚠️ All price APIs failed, using fallback price: $${fallbackPrice} USD`)
    return fallbackPrice
  } catch (error) {
    console.error('❌ Error fetching ROAST price:', error)
    return 0.01 // Fallback price
  }
}

// Fetch from Uniswap V3 subgraph on Base
async function fetchFromUniswap(): Promise<number> {
  try {
    // Base Uniswap V3 subgraph
    const tokenAddress = ROAST_TOKEN_ADDRESS.toLowerCase()
    const query = `
      query {
        tokens(where: { id: "${tokenAddress}" }) {
          derivedETH
          symbol
          name
        }
        bundle(id: "1") {
          ethPriceUSD
        }
      }
    `
    
    console.log(`Fetching Uniswap price for token: ${tokenAddress}`)
    const response = await fetch('https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-base', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    })

    if (!response.ok) {
      throw new Error(`Uniswap API error: ${response.status}`)
    }

    const data = await response.json()
    
    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`)
    }
    
    if (data.data?.tokens?.[0]?.derivedETH && data.data?.bundle?.ethPriceUSD) {
      const token = data.data.tokens[0]
      const derivedETH = parseFloat(token.derivedETH)
      const ethPriceUSD = parseFloat(data.data.bundle.ethPriceUSD)
      const price = derivedETH * ethPriceUSD
      
      console.log(`Uniswap price found: $${price} USD for ${token.symbol || 'ROAST'}`)
      return price
    }

    throw new Error('No Uniswap token data found')
  } catch (error) {
    console.error('Uniswap price fetch failed:', error)
    throw error
  }
}

// Fetch from DEXScreener API
async function fetchFromDEXScreener(): Promise<number> {
  try {
    console.log(`Fetching ROAST price for token: ${ROAST_TOKEN_ADDRESS}`)
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ROAST_TOKEN_ADDRESS}`)
    const data = await response.json()
    
    if (data.pairs && data.pairs.length > 0) {
      // Get the pair with highest liquidity on Base network
      const basePairs = data.pairs.filter((pair: any) => 
        pair.chainId === 'base' || pair.chainId === '8453'
      )
      
      if (basePairs.length > 0) {
        // Sort by liquidity and get the best pair
        const bestPair = basePairs.reduce((prev: any, current: any) => {
          const prevLiq = parseFloat(prev.liquidity?.usd || '0')
          const currLiq = parseFloat(current.liquidity?.usd || '0')
          return currLiq > prevLiq ? current : prev
        })
        
        const price = parseFloat(bestPair.priceUsd)
        console.log(`DEXScreener price found: $${price} USD (from ${bestPair.dexId})`)
        return price || 0
      } else {
        // If no Base pairs, try any available pair
        const anyPair = data.pairs[0]
        if (anyPair?.priceUsd) {
          const price = parseFloat(anyPair.priceUsd)
          console.log(`DEXScreener price found (non-Base): $${price} USD`)
          return price
        }
      }
    }

    throw new Error('No DEXScreener data found')
  } catch (error) {
    console.error('DEXScreener price fetch failed:', error)
    throw error
  }
}

// Fetch from CoinGecko (if ROAST token is listed)
async function fetchFromCoinGecko(): Promise<number> {
  try {
    // Try to find ROAST token by contract address first
    console.log(`Searching CoinGecko for token: ${ROAST_TOKEN_ADDRESS}`)
    
    // Method 1: Try contract address lookup
    try {
      const contractResponse = await fetch(
        `https://api.coingecko.com/api/v3/coins/base/contract/${ROAST_TOKEN_ADDRESS}`
      )
      
      if (contractResponse.ok) {
        const contractData = await contractResponse.json()
        if (contractData?.market_data?.current_price?.usd) {
          const price = contractData.market_data.current_price.usd
          console.log(`CoinGecko price found via contract: $${price} USD`)
          return price
        }
      }
    } catch (contractError) {
      console.log('Contract lookup failed, trying ID-based lookup')
    }

    // Method 2: Try with common ROAST token IDs
    const possibleIds = ['roast-token', 'roast', 'burnie-roast']
    
    for (const tokenId of possibleIds) {
      try {
        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`
        )
        const data = await response.json()
        
        if (data[tokenId]?.usd) {
          const price = data[tokenId].usd
          console.log(`CoinGecko price found via ID (${tokenId}): $${price} USD`)
          return price
        }
      } catch (idError) {
        continue
      }
    }

    throw new Error('ROAST token not found on CoinGecko')
  } catch (error) {
    console.error('CoinGecko price fetch failed:', error)
    throw error
  }
}

// Convert ROAST amount to USDC equivalent
export async function convertROASTToUSDC(roastAmount: number): Promise<number> {
  const roastPrice = await fetchROASTPrice()
  return roastAmount * roastPrice
}

// Format price for display
export function formatUSDCPrice(usdcAmount: number): string {
  if (usdcAmount < 0.01) {
    return '<$0.01'
  }
  return `$${usdcAmount.toFixed(2)}`
}

// Hook for React components to use ROAST price
export function useROASTPrice() {
  const [price, setPrice] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPrice = async () => {
    setLoading(true)
    setError(null)
    try {
      const newPrice = await fetchROASTPrice()
      setPrice(newPrice)
    } catch (err) {
      setError('Failed to fetch price')
      console.error('Price fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPrice()
    // Refresh price every minute
    const interval = setInterval(fetchPrice, 60000)
    return () => clearInterval(interval)
  }, [])

  return { price, loading, error, refetch: fetchPrice }
}

// Test function for debugging - can be called from browser console
export async function testROASTPrice() {
  console.log('🧪 Testing ROAST price fetching...')
  console.log('Token Address:', ROAST_TOKEN_ADDRESS)
  
  try {
    const price = await fetchROASTPrice()
    console.log('✅ Price fetch successful:', price)
    return price
  } catch (error) {
    console.error('❌ Price fetch failed:', error)
    return null
  }
}

// Make test function available globally for debugging
if (typeof window !== 'undefined') {
  (window as any).testROASTPrice = testROASTPrice;
  console.log('🔧 testROASTPrice() function available in browser console');
} 