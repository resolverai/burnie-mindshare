const { AppDataSource } = require('./dist/config/database');
const { MarketplaceContentService } = require('./dist/services/MarketplaceContentService');

async function testMarketplaceEndpoint() {
  try {
    // Initialize database connection
    await AppDataSource.initialize();
    console.log('✅ Database connected');

    const marketplaceService = new MarketplaceContentService();

    // Test 1: Basic marketplace content fetch
    console.log('\n🔍 Test 1: Fetching marketplace content...');
    const result = await marketplaceService.getMarketplaceContent({
      search: '',
      platform_source: '',
      project_name: '',
      post_type: '',
      sort_by: 'bidding_enabled',
      page: 1,
      limit: 5
    });

    console.log(`✅ Successfully fetched ${result.data.length} content items`);
    console.log(`📊 Pagination: Page ${result.currentPage} of ${result.totalPages} (${result.totalItems} total)`);
    
    if (result.data.length > 0) {
      console.log('\n📝 Sample content items:');
      result.data.slice(0, 3).forEach((content, index) => {
        console.log(`  ${index + 1}. ID: ${content.id}, Campaign: ${content.campaign?.title || 'Unknown'}`);
        console.log(`     Bidding Enabled: ${content.bidding_enabled_at || 'Not set'}`);
        console.log(`     Created: ${content.created_at}`);
        console.log(`     Is Biddable: ${content.is_biddable}`);
      });
    }

    // Test 2: Test with search
    console.log('\n🔍 Test 2: Testing search functionality...');
    const searchResult = await marketplaceService.getMarketplaceContent({
      search: 'test',
      platform_source: '',
      project_name: '',
      post_type: '',
      sort_by: 'bidding_enabled',
      page: 1,
      limit: 3
    });

    console.log(`✅ Search returned ${searchResult.data.length} results for "test"`);

    // Test 3: Test search suggestions
    console.log('\n🔍 Test 3: Testing search suggestions...');
    const suggestions = await marketplaceService.getSearchSuggestions();
    
    console.log('✅ Search suggestions:');
    console.log(`  Platforms: ${suggestions.platforms.length} available`);
    console.log(`  Projects: ${suggestions.projects.length} available`);
    console.log(`  Post Types: ${suggestions.post_types.length} available`);

    if (suggestions.platforms.length > 0) {
      console.log(`  Sample platforms: ${suggestions.platforms.slice(0, 3).join(', ')}`);
    }

    console.log('\n✅ All marketplace endpoint tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await AppDataSource.destroy();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the test
testMarketplaceEndpoint();
