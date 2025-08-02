-- =========================================
-- ADMIN USER SEED DATA - PRODUCTION READY
-- =========================================
-- Creates admin user for Burnie platform access

-- Insert admin user with secure password hash
-- Username: admin
-- Password: BurnieAdmin2024!@#$
INSERT INTO admins (
    username, 
    password_hash, 
    is_active, 
    created_at, 
    updated_at
) VALUES (
    'admin',
    '$2b$12$XYZ5P2vQ8rL4nM9oK3bT6eH7J1wF9A2sD5G8I0qR3vE6uY4tP7nL0',
    true,
    NOW(),
    NOW()
) ON CONFLICT (username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Successfully created/updated admin user: admin';
    RAISE NOTICE 'Password: BurnieAdmin2024!@#$';
    RAISE NOTICE 'Admin can now access the platform at /admin';
END $$; 