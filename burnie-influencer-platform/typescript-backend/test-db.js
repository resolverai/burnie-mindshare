#!/usr/bin/env node

const { Client } = require('pg');

console.log('🗄️ Testing PostgreSQL connection...');

const client = new Client({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'roastpower_db'
});

async function testConnection() {
  try {
    console.log('📍 Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected to PostgreSQL successfully!');
    
    // Test query
    const result = await client.query('SELECT version()');
    console.log('📊 PostgreSQL version:', result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]);
    
    // Check if database exists
    const dbResult = await client.query('SELECT current_database()');
    console.log('🗄️ Current database:', dbResult.rows[0].current_database);
    
    // List tables
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    if (tablesResult.rows.length > 0) {
      console.log('📋 Existing tables:', tablesResult.rows.map(row => row.table_name).join(', '));
    } else {
      console.log('📋 No tables found - database is empty');
    }
    
    console.log('✅ Database test completed successfully!');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 PostgreSQL server is not running or not accessible');
      console.error('💡 Try: brew services start postgresql (macOS) or sudo systemctl start postgresql (Linux)');
    } else if (error.code === '28P01') {
      console.error('💡 Authentication failed - check username/password');
    } else if (error.code === '3D000') {
      console.error('💡 Database "roastpower_db" does not exist');
      console.error('💡 Create it with: createdb roastpower_db');
    }
  } finally {
    await client.end();
    process.exit(0);
  }
}

testConnection(); 