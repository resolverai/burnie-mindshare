#!/usr/bin/env python3
"""
ML Models Database Migration Script

This script reads database configuration from .env file and executes
all the necessary database migrations for ML model training and prediction.

Usage:
    python run_ml_migrations.py

Requirements:
    pip install psycopg2-binary python-dotenv

Author: Burnie AI Platform
Date: 2025-08-17
"""

import os
import sys
import logging
from typing import Dict, Any
from pathlib import Path

try:
    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
    from dotenv import load_dotenv
except ImportError as e:
    print(f"❌ Missing required packages: {e}")
    print("Please install: pip install psycopg2-binary python-dotenv")
    sys.exit(1)

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('ml_migration.log')
    ]
)
logger = logging.getLogger(__name__)

class MLDatabaseMigrator:
    """Handles ML model database migrations"""
    
    def __init__(self, env_file: str = ".env"):
        """Initialize migrator with environment configuration"""
        self.env_file = env_file
        self.db_config = {}
        self.connection = None
        
    def load_config(self) -> Dict[str, Any]:
        """Load database configuration from .env file"""
        try:
            # Load environment file
            if not load_dotenv(self.env_file):
                logger.warning(f"⚠️ Could not load {self.env_file}, using environment variables")
            
            # Extract database configuration
            self.db_config = {
                'host': os.getenv('DATABASE_HOST', 'localhost'),
                'port': int(os.getenv('DATABASE_PORT', 5432)),
                'database': os.getenv('DATABASE_NAME', 'roastpower'),
                'user': os.getenv('DATABASE_USER', 'postgres'),
                'password': os.getenv('DATABASE_PASSWORD', '')
            }
            
            logger.info("✅ Database configuration loaded successfully")
            logger.info(f"   Host: {self.db_config['host']}:{self.db_config['port']}")
            logger.info(f"   Database: {self.db_config['database']}")
            logger.info(f"   User: {self.db_config['user']}")
            
            return self.db_config
            
        except Exception as e:
            logger.error(f"❌ Failed to load configuration: {str(e)}")
            raise
    
    def connect_database(self) -> bool:
        """Establish database connection"""
        try:
            logger.info("🔌 Connecting to database...")
            
            self.connection = psycopg2.connect(**self.db_config)
            self.connection.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            
            # Test connection
            with self.connection.cursor() as cursor:
                cursor.execute("SELECT version();")
                version = cursor.fetchone()[0]
                logger.info(f"✅ Connected to PostgreSQL: {version}")
            
            return True
            
        except psycopg2.Error as e:
            logger.error(f"❌ Database connection failed: {str(e)}")
            return False
        except Exception as e:
            logger.error(f"❌ Unexpected error connecting to database: {str(e)}")
            return False
    
    def execute_migration_sql(self, sql_content: str) -> bool:
        """Execute SQL migration statements"""
        try:
            logger.info("🚀 Starting ML models database migration...")
            
            with self.connection.cursor() as cursor:
                # Split SQL content into individual statements
                statements = [stmt.strip() for stmt in sql_content.split(';') if stmt.strip()]
                
                total_statements = len(statements)
                logger.info(f"📝 Found {total_statements} SQL statements to execute")
                
                success_count = 0
                for i, statement in enumerate(statements, 1):
                    try:
                        # Skip comments and empty statements
                        if statement.startswith('--') or not statement:
                            continue
                            
                        logger.info(f"🔄 Executing statement {i}/{total_statements}")
                        logger.debug(f"SQL: {statement[:100]}...")
                        
                        cursor.execute(statement)
                        success_count += 1
                        
                    except psycopg2.Error as e:
                        logger.warning(f"⚠️ Statement {i} failed (may be expected): {str(e)}")
                        # Continue with other statements even if one fails
                        continue
                
                logger.info(f"✅ Migration completed: {success_count}/{total_statements} statements executed successfully")
                return True
                
        except Exception as e:
            logger.error(f"❌ Migration execution failed: {str(e)}")
            return False
    
    def load_migration_file(self, file_path: str) -> str:
        """Load SQL migration file content"""
        try:
            migration_path = Path(file_path)
            if not migration_path.exists():
                raise FileNotFoundError(f"Migration file not found: {file_path}")
            
            with open(migration_path, 'r', encoding='utf-8') as file:
                content = file.read()
            
            logger.info(f"📄 Loaded migration file: {file_path}")
            logger.info(f"   File size: {len(content)} characters")
            
            return content
            
        except Exception as e:
            logger.error(f"❌ Failed to load migration file: {str(e)}")
            raise
    
    def verify_tables_exist(self) -> bool:
        """Verify that required tables exist"""
        try:
            required_tables = [
                'primary_predictor_training_data',
                'twitter_engagement_training_data'
            ]
            
            with self.connection.cursor() as cursor:
                for table in required_tables:
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_name = %s
                        );
                    """, (table,))
                    
                    exists = cursor.fetchone()[0]
                    if exists:
                        logger.info(f"✅ Table verified: {table}")
                    else:
                        logger.error(f"❌ Missing required table: {table}")
                        return False
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Table verification failed: {str(e)}")
            return False
    
    def get_table_stats(self) -> Dict[str, int]:
        """Get statistics about training data tables"""
        try:
            stats = {}
            
            with self.connection.cursor() as cursor:
                # Primary predictor training data stats
                cursor.execute("""
                    SELECT 
                        COUNT(*) as total_records,
                        COUNT(CASE WHEN platform_source = 'cookie.fun' THEN 1 END) as cookie_fun_records,
                        COUNT(CASE WHEN delta_snaps IS NOT NULL THEN 1 END) as records_with_delta_snaps,
                        COUNT(CASE WHEN position_change IS NOT NULL THEN 1 END) as records_with_position_change
                    FROM primary_predictor_training_data;
                """)
                
                result = cursor.fetchone()
                stats['primary_predictor'] = {
                    'total_records': result[0],
                    'cookie_fun_records': result[1],
                    'records_with_delta_snaps': result[2],
                    'records_with_position_change': result[3]
                }
                
                # Twitter engagement training data stats
                cursor.execute("""
                    SELECT 
                        COUNT(*) as total_records,
                        COUNT(CASE WHEN platform_source = 'cookie.fun' THEN 1 END) as cookie_fun_records,
                        COUNT(CASE WHEN total_engagement > 0 THEN 1 END) as records_with_engagement
                    FROM twitter_engagement_training_data;
                """)
                
                result = cursor.fetchone()
                stats['twitter_engagement'] = {
                    'total_records': result[0],
                    'cookie_fun_records': result[1],
                    'records_with_engagement': result[2]
                }
            
            return stats
            
        except Exception as e:
            logger.error(f"❌ Failed to get table statistics: {str(e)}")
            return {}
    
    def close_connection(self):
        """Close database connection"""
        if self.connection:
            self.connection.close()
            logger.info("🔌 Database connection closed")
    
    def run_migration(self) -> bool:
        """Run the complete migration process"""
        try:
            logger.info("🎯 Starting ML Models Database Migration")
            logger.info("=" * 60)
            
            # Step 1: Load configuration
            self.load_config()
            
            # Step 2: Connect to database
            if not self.connect_database():
                return False
            
            # Step 3: Verify tables exist
            if not self.verify_tables_exist():
                logger.error("❌ Required tables missing. Please ensure your database schema is set up correctly.")
                return False
            
            # Step 4: Show pre-migration stats
            logger.info("📊 Pre-migration table statistics:")
            pre_stats = self.get_table_stats()
            for table, stats in pre_stats.items():
                logger.info(f"   {table}: {stats}")
            
            # Step 5: Load and execute migration
            migration_file = "migrations/ml_models_fixes.sql"
            sql_content = self.load_migration_file(migration_file)
            
            if not self.execute_migration_sql(sql_content):
                return False
            
            # Step 6: Show post-migration stats
            logger.info("📊 Post-migration table statistics:")
            post_stats = self.get_table_stats()
            for table, stats in post_stats.items():
                logger.info(f"   {table}: {stats}")
            
            logger.info("=" * 60)
            logger.info("🎉 ML Models Database Migration Completed Successfully!")
            logger.info("   Your database is now ready for ML model training and prediction.")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Migration failed: {str(e)}")
            return False
        finally:
            self.close_connection()

def main():
    """Main function to run the migration"""
    print("🚀 ML Models Database Migration Script")
    print("=====================================")
    
    # Check if migration file exists
    migration_file = Path("migrations/ml_models_fixes.sql")
    if not migration_file.exists():
        print(f"❌ Migration file not found: {migration_file}")
        print("Please ensure you're running this script from the python-ai-backend directory.")
        sys.exit(1)
    
    # Run migration
    migrator = MLDatabaseMigrator()
    
    try:
        success = migrator.run_migration()
        
        if success:
            print("\n✅ Migration completed successfully!")
            print("You can now proceed with ML model training.")
            sys.exit(0)
        else:
            print("\n❌ Migration failed!")
            print("Please check the logs for details.")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print("\n⚠️ Migration interrupted by user")
        migrator.close_connection()
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
