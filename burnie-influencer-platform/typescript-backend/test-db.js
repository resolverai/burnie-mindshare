require('dotenv').config();
const { DataSource } = require('typeorm');

// Use same exact config as the app
const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'roastpower',
  synchronize: true,
  logging: true
});

console.log('🗄️ Testing database connection...');
console.log('📍 Config:', {
  host: AppDataSource.options.host,
  port: AppDataSource.options.port,
  database: AppDataSource.options.database,
  username: AppDataSource.options.username
});

AppDataSource.initialize()
  .then(() => {
    console.log('✅ Database connection successful');
    return AppDataSource.query('SELECT COUNT(*) as count FROM projects');
  })
  .then(result => {
    console.log('📊 Projects found:', result[0].count);
    return AppDataSource.destroy();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });
