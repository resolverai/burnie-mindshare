/**
 * Test utility to verify token metadata service functionality
 * Can be used in browser console to test the DEX API integration
 */

import { tokenMetadataService } from '../services/tokenMetadataService';

// Test function that can be called from browser console
export async function testROASTMetadata() {
  console.log('🧪 Testing ROAST token metadata service...');
  
  try {
    // Clear cache to ensure fresh data
    tokenMetadataService.clearCache();
    
    // Fetch metadata
    const metadata = await tokenMetadataService.getROASTTokenMetadata();
    
    if (metadata) {
      console.log('✅ Token metadata successfully fetched:');
      console.table({
        'Contract Address': metadata.address,
        'Name': metadata.name,
        'Symbol': metadata.symbol,
        'Decimals': metadata.decimals,
        'Image URL': metadata.image,
        'Current Price': metadata.price ? `$${metadata.price.toFixed(6)}` : 'N/A',
        '24h Change': metadata.priceChange24h ? `${metadata.priceChange24h.toFixed(2)}%` : 'N/A',
        'Market Cap': metadata.marketCap ? `$${(metadata.marketCap / 1000000).toFixed(2)}M` : 'N/A',
        'Volume 24h': metadata.volume24h ? `$${(metadata.volume24h / 1000000).toFixed(2)}M` : 'N/A',
        'Chain ID': metadata.chainId
      });
      
      // Test image accessibility
      if (metadata.image) {
        console.log('🖼️ Testing image accessibility...');
        const img = new Image();
        img.onload = () => console.log('✅ Token image loads successfully');
        img.onerror = () => console.log('❌ Token image failed to load');
        img.src = metadata.image;
      }
      
      return metadata;
    } else {
      console.log('❌ Failed to fetch token metadata');
      return null;
    }
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    return null;
  }
}

// Make it available on window for easy browser console testing
if (typeof window !== 'undefined') {
  (window as any).testROASTMetadata = testROASTMetadata;
  console.log('🧪 Token metadata test available: window.testROASTMetadata()');
}

export default testROASTMetadata;
