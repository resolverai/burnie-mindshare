const { AppDataSource } = require('./dist/config/database');
const { ContentMarketplace } = require('./dist/models/ContentMarketplace');

async function debugWatermarkUrls() {
  try {
    // Initialize database connection
    await AppDataSource.initialize();
    console.log('✅ Database connected');

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Find content with watermark images
    const contentWithWatermarks = await contentRepository
      .createQueryBuilder('content')
      .where('content.watermarkImage IS NOT NULL')
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .limit(5)
      .getMany();

    console.log(`\n🔍 Found ${contentWithWatermarks.length} content items with watermark images:`);
    
    contentWithWatermarks.forEach((content, index) => {
      console.log(`\n${index + 1}. Content ID: ${content.id}`);
      console.log(`   Campaign ID: ${content.campaignId}`);
      console.log(`   Watermark URL: ${content.watermarkImage}`);
      console.log(`   URL Length: ${content.watermarkImage.length}`);
      console.log(`   Contains S3: ${content.watermarkImage.includes('s3.amazonaws.com')}`);
      console.log(`   Contains Query Params: ${content.watermarkImage.includes('?')}`);
      
      // Test S3 key extraction
      const url = new URL(content.watermarkImage);
      const s3Key = url.pathname.substring(1); // Remove leading slash
      console.log(`   Extracted S3 Key: ${s3Key}`);
      console.log(`   S3 Key starts with 'watermarked/': ${s3Key.startsWith('watermarked/')}`);
    });

    // Test AWS configuration
    console.log('\n🔧 AWS Configuration:');
    console.log(`   AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET'}`);
    console.log(`   AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`   AWS_REGION: ${process.env.AWS_REGION || 'NOT SET'}`);
    console.log(`   S3_BUCKET_NAME: ${process.env.S3_BUCKET_NAME || 'NOT SET'}`);

    // Test S3 presigned URL generation
    if (contentWithWatermarks.length > 0) {
      console.log('\n🧪 Testing S3 presigned URL generation...');
      const AWS = require('aws-sdk');
      
      const s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1',
        signatureVersion: 'v4'
      });

      const testContent = contentWithWatermarks[0];
      const url = new URL(testContent.watermarkImage);
      const s3Key = url.pathname.substring(1);
      
      try {
        const presignedUrl = s3.getSignedUrl('getObject', {
          Bucket: process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging',
          Key: s3Key,
          Expires: 3600
        });
        
        console.log(`✅ Successfully generated presigned URL for: ${s3Key}`);
        console.log(`   Original URL: ${testContent.watermarkImage}`);
        console.log(`   Presigned URL: ${presignedUrl.substring(0, 150)}...`);
        
        // Test if the presigned URL is accessible
        const fetch = require('node-fetch');
        console.log('\n🔗 Testing presigned URL accessibility...');
        
        const response = await fetch(presignedUrl, { method: 'HEAD' });
        console.log(`   Status: ${response.status} ${response.statusText}`);
        console.log(`   Headers: ${JSON.stringify(Object.fromEntries(response.headers), null, 2)}`);
        
      } catch (error) {
        console.error(`❌ Failed to generate presigned URL:`, error);
      }
    }

  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    await AppDataSource.destroy();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the debug
debugWatermarkUrls();
