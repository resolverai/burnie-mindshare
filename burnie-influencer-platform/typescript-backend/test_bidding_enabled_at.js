const { AppDataSource } = require('./dist/config/database');
const { ContentMarketplace } = require('./dist/models/ContentMarketplace');

async function testBiddingEnabledAt() {
  try {
    // Initialize database connection
    await AppDataSource.initialize();
    console.log('✅ Database connected');

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Test 1: Check for content missing biddingEnabledAt
    console.log('\n🔍 Test 1: Checking for content missing biddingEnabledAt...');
    const missingBiddingEnabledAt = await contentRepository
      .createQueryBuilder('content')
      .where('content.isBiddable = :isBiddable', { isBiddable: true })
      .andWhere('content.biddingEnabledAt IS NULL')
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .getMany();

    if (missingBiddingEnabledAt.length > 0) {
      console.log(`⚠️ Found ${missingBiddingEnabledAt.length} biddable content items missing biddingEnabledAt:`);
      missingBiddingEnabledAt.forEach(content => {
        console.log(`  - ID: ${content.id}, Campaign: ${content.campaign?.title || 'Unknown'}, Created: ${content.createdAt}`);
      });
    } else {
      console.log('✅ All biddable content has biddingEnabledAt field populated');
    }

    // Test 2: Check content with biddingEnabledAt
    console.log('\n🔍 Test 2: Checking content with biddingEnabledAt...');
    const withBiddingEnabledAt = await contentRepository
      .createQueryBuilder('content')
      .where('content.isBiddable = :isBiddable', { isBiddable: true })
      .andWhere('content.biddingEnabledAt IS NOT NULL')
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .orderBy('content.biddingEnabledAt', 'DESC')
      .limit(5)
      .getMany();

    console.log(`✅ Found ${withBiddingEnabledAt.length} content items with biddingEnabledAt:`);
    withBiddingEnabledAt.forEach(content => {
      console.log(`  - ID: ${content.id}, Campaign: ${content.campaign?.title || 'Unknown'}, Bidding Enabled: ${content.biddingEnabledAt}`);
    });

    // Test 3: Test sorting by biddingEnabledAt
    console.log('\n🔍 Test 3: Testing sorting by biddingEnabledAt...');
    const sortedContent = await contentRepository
      .createQueryBuilder('content')
      .where('content.approvalStatus = :status', { status: 'approved' })
      .andWhere('content.isAvailable = true')
      .andWhere('content.isBiddable = true')
      .orderBy('content.biddingEnabledAt', 'DESC')
      .limit(10)
      .getMany();

    console.log(`✅ Sorted ${sortedContent.length} content items by biddingEnabledAt (with fallback):`);
    sortedContent.forEach((content, index) => {
      const sortDate = content.biddingEnabledAt || content.createdAt;
      const dateType = content.biddingEnabledAt ? 'biddingEnabledAt' : 'createdAt (fallback)';
      console.log(`  ${index + 1}. ID: ${content.id}, Campaign: ${content.campaign?.title || 'Unknown'}, Sort Date: ${sortDate} (${dateType})`);
    });

    // Test 4: Check database statistics
    console.log('\n🔍 Test 4: Database statistics...');
    const stats = await contentRepository
      .createQueryBuilder('content')
      .select([
        'COUNT(*) as total',
        'COUNT(CASE WHEN content.isBiddable = true THEN 1 END) as biddable',
        'COUNT(CASE WHEN content.isBiddable = true AND content.biddingEnabledAt IS NOT NULL THEN 1 END) as biddable_with_date',
        'COUNT(CASE WHEN content.isBiddable = true AND content.biddingEnabledAt IS NULL THEN 1 END) as biddable_missing_date'
      ])
      .where('content.approvalStatus = :status', { status: 'approved' })
      .getRawOne();

    console.log('📊 Content Statistics:');
    console.log(`  - Total approved content: ${stats.total}`);
    console.log(`  - Biddable content: ${stats.biddable}`);
    console.log(`  - Biddable with biddingEnabledAt: ${stats.biddable_with_date}`);
    console.log(`  - Biddable missing biddingEnabledAt: ${stats.biddable_missing_date}`);

    if (parseInt(stats.biddable_missing_date) > 0) {
      console.log('\n⚠️ WARNING: Some biddable content is missing biddingEnabledAt field!');
      console.log('   This may cause sorting issues in the marketplace.');
      console.log('   Consider running the migration script: fix_bidding_enabled_at.sql');
    } else {
      console.log('\n✅ All biddable content has proper biddingEnabledAt field!');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await AppDataSource.destroy();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the test
testBiddingEnabledAt();
