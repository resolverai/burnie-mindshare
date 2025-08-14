#!/usr/bin/env python3
"""
Migration Script: Backfill Projects Table from Campaigns

This script identifies campaigns in the campaigns table that have project names
but no corresponding entries in the projects table, and creates those missing
project entries.

Usage:
    python backfill_projects.py

Prerequisites:
    - Ensure the database is accessible
    - Install required dependencies: psycopg2-binary, python-dotenv
"""

import os
import sys
import logging
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('backfill_projects.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

class ProjectsBackfillService:
    """Service to backfill missing projects from campaigns table"""
    
    def __init__(self):
        # Load environment variables
        load_dotenv()
        
        self.db_config = {
            'host': os.getenv('DATABASE_HOST', 'localhost'),
            'port': int(os.getenv('DATABASE_PORT', 5434)),
            'database': os.getenv('DATABASE_NAME', 'roastpower'),
            'user': os.getenv('DATABASE_USER', 'postgres'),
            'password': os.getenv('DATABASE_PASSWORD', '')
        }
        
        logger.info(f"🔧 Database config: {self.db_config['host']}:{self.db_config['port']}/{self.db_config['database']}")
        
    def get_database_connection(self):
        """Get database connection"""
        try:
            conn = psycopg2.connect(**self.db_config)
            conn.autocommit = False  # Use transactions
            logger.info("✅ Database connection established")
            return conn
        except Exception as e:
            logger.error(f"❌ Failed to connect to database: {e}")
            raise
    
    def get_campaigns_without_projects(self, conn) -> List[Dict[str, Any]]:
        """
        Get campaigns that have project names but no corresponding project entries
        """
        query = """
        SELECT DISTINCT 
            c.id as campaign_id,
            c."projectName" as project_name,
            c."projectLogo" as project_logo,
            c.description as campaign_description,
            c.title as campaign_title,
            c."tokenTicker" as token_ticker,
            c."brandGuidelines" as brand_guidelines
        FROM campaigns c
        LEFT JOIN projects p ON LOWER(TRIM(p.name)) = LOWER(TRIM(c."projectName"))
        WHERE c."projectName" IS NOT NULL 
        AND c."projectName" != '' 
        AND TRIM(c."projectName") != ''
        AND p.id IS NULL
        ORDER BY c."projectName";
        """
        
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query)
                results = cursor.fetchall()
                
                campaigns = [dict(row) for row in results]
                logger.info(f"📊 Found {len(campaigns)} campaigns with missing project entries")
                
                # Log the campaign/project names for review
                for campaign in campaigns:
                    logger.info(f"  - Campaign '{campaign['campaign_title']}' -> Project '{campaign['project_name']}'")
                
                return campaigns
                
        except Exception as e:
            logger.error(f"❌ Error fetching campaigns without projects: {e}")
            raise
    
    def get_existing_projects(self, conn) -> Dict[str, int]:
        """Get existing projects as a name -> id mapping"""
        query = "SELECT id, name FROM projects WHERE name IS NOT NULL AND TRIM(name) != ''"
        
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query)
                results = cursor.fetchall()
                
                projects_map = {
                    row['name'].strip().lower(): row['id'] 
                    for row in results
                }
                
                logger.info(f"📋 Found {len(projects_map)} existing projects in database")
                return projects_map
                
        except Exception as e:
            logger.error(f"❌ Error fetching existing projects: {e}")
            raise
    
    def ensure_default_user_exists(self, conn) -> int:
        """Ensure default user exists for project ownership"""
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                # Check if default user exists
                cursor.execute("SELECT id FROM users WHERE id = 1")
                user = cursor.fetchone()
                
                if user:
                    logger.info("✅ Default user (id=1) already exists")
                    return 1
                
                # Create default user
                logger.info("🏗️ Creating default user for project ownership...")
                insert_user_query = """
                INSERT INTO users (
                    id, "walletAddress", username, email, "isVerified", "isAdmin", profile, "createdAt", "updatedAt"
                ) VALUES (
                    1, 
                    '0x0000000000000000000000000000000000000001', 
                    'admin', 
                    'admin@burnie.co', 
                    true, 
                    true, 
                    '{"displayName": "System Admin", "bio": "Default system administrator for project ownership", "website": "https://burnie.co"}', 
                    NOW(), 
                    NOW()
                ) ON CONFLICT (id) DO NOTHING
                """
                
                cursor.execute(insert_user_query)
                logger.info("✅ Default user created successfully")
                return 1
                
        except Exception as e:
            logger.error(f"❌ Error ensuring default user exists: {e}")
            raise
    
    def create_projects_from_campaigns(self, conn, campaigns: List[Dict[str, Any]], owner_id: int) -> List[Dict[str, Any]]:
        """
        Create project entries from campaign data
        """
        created_projects = []
        
        # Group campaigns by project name to avoid duplicates
        projects_to_create = {}
        for campaign in campaigns:
            project_name = campaign['project_name'].strip()
            if project_name not in projects_to_create:
                projects_to_create[project_name] = campaign
        
        logger.info(f"📋 Will create {len(projects_to_create)} unique projects from {len(campaigns)} campaigns")
        
        for project_name, representative_campaign in projects_to_create.items():
            try:
                # Double-check that project doesn't exist before creating
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute(
                        "SELECT id, name FROM projects WHERE LOWER(TRIM(name)) = LOWER(TRIM(%s))",
                        (project_name,)
                    )
                    existing = cursor.fetchone()
                    
                    if existing:
                        logger.info(f"⚠️ Project '{project_name}' already exists with ID {existing['id']}, skipping creation")
                        # Still add it to created_projects so campaigns get linked
                        created_projects.append({
                            'id': existing['id'],
                            'name': existing['name'],
                            'campaign_id': representative_campaign['campaign_id'],
                            'campaign_title': representative_campaign['campaign_title']
                        })
                        continue
                
                # Prepare project data
                project_data = {
                    'name': project_name,
                    'description': (
                        representative_campaign['campaign_description'] or 
                        f"Project for campaign: {representative_campaign['campaign_title']}"
                    ),
                    'logo': representative_campaign['project_logo'],
                    'owner_id': owner_id,
                    'is_active': True
                }
                
                # Create socialLinks JSON if we have token ticker info
                social_links = {}
                if representative_campaign['token_ticker']:
                    social_links['token'] = representative_campaign['token_ticker']
                
                # Create brandGuidelines JSON
                brand_guidelines = {}
                if representative_campaign['brand_guidelines']:
                    brand_guidelines['description'] = representative_campaign['brand_guidelines']
                
                # Use a savepoint for this individual project creation
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute("SAVEPOINT project_creation")
                    try:
                        # Insert project
                        insert_query = """
                        INSERT INTO projects (
                            name, description, logo, "socialLinks", "brandGuidelines", 
                            "isActive", "ownerId", "createdAt", "updatedAt"
                        ) VALUES (
                            %(name)s, %(description)s, %(logo)s, %(social_links)s, %(brand_guidelines)s,
                            %(is_active)s, %(owner_id)s, NOW(), NOW()
                        ) RETURNING id, name
                        """
                        
                        cursor.execute(insert_query, {
                            'name': project_data['name'],
                            'description': project_data['description'],
                            'logo': project_data['logo'],
                            'social_links': Json(social_links) if social_links else None,
                            'brand_guidelines': Json(brand_guidelines) if brand_guidelines else None,
                            'is_active': project_data['is_active'],
                            'owner_id': project_data['owner_id']
                        })
                        
                        result = cursor.fetchone()
                        cursor.execute("RELEASE SAVEPOINT project_creation")
                        
                        if result:
                            created_project = {
                                'id': result['id'],
                                'name': result['name'],
                                'campaign_id': representative_campaign['campaign_id'],
                                'campaign_title': representative_campaign['campaign_title']
                            }
                            created_projects.append(created_project)
                            logger.info(f"✅ Created project: {result['id']} - '{result['name']}' (from campaign: {representative_campaign['campaign_title']})")
                    
                    except Exception as insert_error:
                        cursor.execute("ROLLBACK TO SAVEPOINT project_creation")
                        raise insert_error
                    
            except Exception as e:
                logger.error(f"❌ Error creating project for campaign '{representative_campaign['campaign_title']}': {e}")
                # Continue with other projects even if one fails
                continue
        
        return created_projects
    
    def update_campaigns_with_project_ids(self, conn, created_projects: List[Dict[str, Any]], all_campaigns: List[Dict[str, Any]]):
        """
        Update campaigns table to link to the newly created projects
        """
        updated_count = 0
        
        # Create a mapping of project name to project ID
        project_name_to_id = {}
        for project in created_projects:
            project_name_to_id[project['name'].strip().lower()] = project['id']
        
        # Update all campaigns that match the project names
        for campaign in all_campaigns:
            project_name = campaign['project_name'].strip().lower()
            
            if project_name in project_name_to_id:
                try:
                    project_id = project_name_to_id[project_name]
                    
                    update_query = """
                    UPDATE campaigns 
                    SET "projectId" = %(project_id)s, "updatedAt" = NOW()
                    WHERE id = %(campaign_id)s AND LOWER(TRIM("projectName")) = %(project_name)s
                    """
                    
                    with conn.cursor() as cursor:
                        cursor.execute(update_query, {
                            'project_id': project_id,
                            'campaign_id': campaign['campaign_id'],
                            'project_name': project_name
                        })
                        
                        if cursor.rowcount > 0:
                            updated_count += 1
                            logger.info(f"✅ Updated campaign {campaign['campaign_id']} ('{campaign['campaign_title']}') to link to project {project_id}")
                        else:
                            logger.warning(f"⚠️ No rows updated for campaign {campaign['campaign_id']}")
                            
                except Exception as e:
                    logger.error(f"❌ Error updating campaign {campaign['campaign_id']}: {e}")
                    continue
        
        logger.info(f"📊 Updated {updated_count} campaigns with project IDs")
        return updated_count
    
    def run_backfill(self, dry_run: bool = False) -> Dict[str, Any]:
        """
        Run the complete backfill process
        
        Args:
            dry_run: If True, only analyze what would be done without making changes
            
        Returns:
            Dictionary with summary of actions taken
        """
        logger.info("🚀 Starting projects backfill process...")
        logger.info(f"📋 Mode: {'DRY RUN' if dry_run else 'LIVE RUN'}")
        
        conn = None
        summary = {
            'campaigns_found': 0,
            'projects_created': 0,
            'campaigns_updated': 0,
            'errors': [],
            'dry_run': dry_run
        }
        
        try:
            # Get database connection
            conn = self.get_database_connection()
            
            # Transaction is automatically started with autocommit=False
            # No need to call conn.begin() in psycopg2
            
            # Get campaigns without projects
            campaigns = self.get_campaigns_without_projects(conn)
            summary['campaigns_found'] = len(campaigns)
            
            if not campaigns:
                logger.info("✅ No campaigns found that need project entries - database is consistent!")
                conn.rollback()
                return summary
            
            # Ensure default user exists
            owner_id = self.ensure_default_user_exists(conn)
            
            if dry_run:
                logger.info("🔍 DRY RUN - Would create the following projects:")
                for i, campaign in enumerate(campaigns, 1):
                    logger.info(f"  {i}. Project: '{campaign['project_name']}' (from campaign: '{campaign['campaign_title']}')")
                
                conn.rollback()
                logger.info("✅ DRY RUN completed - no changes made")
                return summary
            
            # Create projects from campaigns
            created_projects = self.create_projects_from_campaigns(conn, campaigns, owner_id)
            summary['projects_created'] = len(created_projects)
            
            # Update campaigns with new project IDs
            updated_count = self.update_campaigns_with_project_ids(conn, created_projects, campaigns)
            summary['campaigns_updated'] = updated_count
            
            # Commit transaction
            conn.commit()
            
            logger.info("✅ Projects backfill completed successfully!")
            logger.info(f"📊 Summary:")
            logger.info(f"  - Campaigns analyzed: {summary['campaigns_found']}")
            logger.info(f"  - Projects created: {summary['projects_created']}")
            logger.info(f"  - Campaigns updated: {summary['campaigns_updated']}")
            
            return summary
            
        except Exception as e:
            if conn:
                conn.rollback()
            error_msg = f"❌ Backfill process failed: {e}"
            logger.error(error_msg)
            summary['errors'].append(str(e))
            raise
            
        finally:
            if conn:
                conn.close()
                logger.info("🔌 Database connection closed")

def main():
    """Main function to run the backfill script"""
    
    # Parse command line arguments
    dry_run = '--dry-run' in sys.argv or '-d' in sys.argv
    
    print("=" * 60)
    print("🏗️  PROJECTS TABLE BACKFILL SCRIPT")
    print("=" * 60)
    print("")
    
    if dry_run:
        print("🔍 Running in DRY RUN mode - no changes will be made")
    else:
        print("⚠️  Running in LIVE mode - changes will be made to database")
        response = input("Are you sure you want to continue? (yes/no): ")
        if response.lower() not in ['yes', 'y']:
            print("❌ Operation cancelled by user")
            return
    
    print("")
    
    try:
        service = ProjectsBackfillService()
        summary = service.run_backfill(dry_run=dry_run)
        
        print("\n" + "=" * 60)
        print("📊 BACKFILL SUMMARY")
        print("=" * 60)
        print(f"Mode: {'DRY RUN' if summary['dry_run'] else 'LIVE RUN'}")
        print(f"Campaigns found needing projects: {summary['campaigns_found']}")
        print(f"Projects created: {summary['projects_created']}")
        print(f"Campaigns updated: {summary['campaigns_updated']}")
        
        if summary['errors']:
            print(f"Errors encountered: {len(summary['errors'])}")
            for error in summary['errors']:
                print(f"  - {error}")
        else:
            print("✅ No errors encountered")
        
        print("=" * 60)
        
        if not dry_run and summary['projects_created'] > 0:
            print("\n🎉 Backfill completed successfully!")
            print("💡 You may now want to run Twitter data fetching for these new projects")
        
    except Exception as e:
        print(f"\n❌ Script failed with error: {e}")
        print("📋 Check the log file 'backfill_projects.log' for detailed error information")
        sys.exit(1)

if __name__ == "__main__":
    main()
