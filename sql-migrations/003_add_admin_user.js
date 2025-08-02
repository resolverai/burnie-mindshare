const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const password = 'BurnieAdmin2024!@#$';
const saltRounds = 12;

async function addAdmin() {
  // Generate bcrypt hash
  const password_hash = await bcrypt.hash(password, saltRounds);
  
  // Database connection
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    // Insert admin user
    const result = await pool.query(`
      INSERT INTO admins (username, password_hash, is_active, created_at, updated_at) 
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (username) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING id, username;
    `, ['admin', password_hash, true]);
    
    console.log('Admin user created/updated:', result.rows[0]);
  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    await pool.end();
  }
}

addAdmin(); 