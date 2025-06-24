const { Client } = require('pg');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function setupDatabase() {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
  };
  
  const dbName = process.env.DB_NAME || 'roastpower';
  
  console.log('🗄️ Setting up PostgreSQL database...');
  console.log(`📍 Host: ${dbConfig.host}:${dbConfig.port}`);
  console.log(`👤 User: ${dbConfig.user}`);
  console.log(`📂 Database: ${dbName}`);
  
  // Connect to PostgreSQL server (without specifying database)
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL server');
    
    // Check if database exists
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );
    
    if (result.rows.length === 0) {
      // Database doesn't exist, create it
      console.log(`🔨 Creating database '${dbName}'...`);
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ Database '${dbName}' created successfully`);
    } else {
      console.log(`📋 Database '${dbName}' already exists`);
    }
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Solution: Start PostgreSQL server');
      console.error('   macOS: brew services start postgresql');
      console.error('   Ubuntu: sudo service postgresql start');
      console.error('   Windows: Start PostgreSQL service from Services panel');
    } else if (error.code === '28P01') {
      console.error('💡 Solution: Check your database credentials in .env file');
    } else if (error.code === '3D000') {
      console.error('💡 Solution: Database connection issue, check host and port');
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run setup if called directly
if (require.main === module) {
  setupDatabase()
    .then(() => {
      console.log('🎉 Database setup completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { setupDatabase }; 