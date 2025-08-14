# Projects Table Backfill Script

This script addresses the issue where campaigns were created with project names but without corresponding entries in the `projects` table. It ensures database consistency by creating missing project records.

## Problem Statement

Previously, the admin dashboard allowed creating campaigns with project names, but these projects weren't automatically created in the `projects` table. This led to:

1. **Inconsistent data**: Project names stored only in campaigns table
2. **Failed Twitter data fetching**: Project Twitter data couldn't be stored without project records
3. **Broken foreign key relationships**: Campaigns couldn't properly link to projects

## Solution

The script automatically:

1. **Identifies missing projects**: Finds campaigns with project names but no corresponding project records
2. **Creates project entries**: Generates proper project records with metadata from campaigns
3. **Links campaigns**: Updates campaigns to reference the newly created projects
4. **Maintains consistency**: Ensures one project has only one entry in the projects table

## Usage

### Prerequisites

```bash
# Install required dependencies
pip install psycopg2-binary python-dotenv

# Ensure database connection details are in .env file
```

### Run in Dry-Run Mode (Recommended First)

```bash
cd burnie-influencer-platform/python-ai-backend
python backfill_projects.py --dry-run
```

This will show you what projects would be created without making any changes.

### Run Live Migration

```bash
python backfill_projects.py
```

You'll be prompted to confirm before making changes.

## What the Script Does

### 1. Analysis Phase
- Scans the `campaigns` table for entries with `projectName` but no corresponding `projects` entry
- Groups campaigns by project name to avoid duplicates
- Reports what would be created

### 2. Project Creation Phase
- Creates missing project records with:
  - Name from campaign's `projectName`
  - Description from campaign's description or auto-generated
  - Logo from campaign's `projectLogo`
  - Token ticker in `socialLinks`
  - Brand guidelines if available
  - Default ownership to admin user (id=1)

### 3. Linking Phase
- Updates campaigns to reference the newly created project IDs
- Ensures proper foreign key relationships

## Example Output

```
🚀 Starting projects backfill process...
📋 Mode: LIVE RUN

✅ Database connection established
📊 Found 3 campaigns with missing project entries
  - Campaign 'Earn BOB Rewards' -> Project 'BOB'
  - Campaign 'DOGE Community' -> Project 'Dogecoin'
  - Campaign 'ETH Staking' -> Project 'Ethereum'

🏗️ Creating new project: BOB
✅ Project created: 15 - 'BOB' (from campaign: Earn BOB Rewards)
🏗️ Creating new project: Dogecoin
✅ Project created: 16 - 'Dogecoin' (from campaign: DOGE Community)
🏗️ Creating new project: Ethereum
✅ Project created: 17 - 'Ethereum' (from campaign: ETH Staking)

✅ Updated campaign 2 to link to project 15
✅ Updated campaign 5 to link to project 16
✅ Updated campaign 8 to link to project 17

✅ Projects backfill completed successfully!
📊 Summary:
  - Campaigns analyzed: 3
  - Projects created: 3
  - Campaigns updated: 3
```

## Safety Features

- **Dry-run mode**: Preview changes without modifying data
- **Transaction safety**: All changes in a single transaction (rollback on error)
- **Duplicate prevention**: Checks for existing projects by name (case-insensitive)
- **Error handling**: Continues processing other projects if one fails
- **Detailed logging**: Complete audit trail in `backfill_projects.log`

## Database Schema Impact

### Before Migration
```
campaigns table:
- projectName: "BOB"
- projectLogo: "s3://..."
- projectId: null (no project exists)

projects table:
- (empty for this project)
```

### After Migration
```
campaigns table:
- projectName: "BOB"
- projectLogo: "s3://..."
- projectId: 15 (links to project)

projects table:
- id: 15
- name: "BOB"
- logo: "s3://..."
- socialLinks: {"token": "BOB"}
```

## Integration with New Features

After running this script, the improved admin dashboard will:

1. **Prevent future issues**: New campaigns automatically create or link to existing projects
2. **Enable searchable dropdown**: Project names can be searched and selected
3. **Support Twitter integration**: Projects can have Twitter data fetched and stored
4. **Maintain consistency**: One project name = one project record

## Troubleshooting

### Common Issues

1. **Database connection failed**: Check `.env` file and database accessibility
2. **Permission denied**: Ensure database user has INSERT/UPDATE permissions
3. **Duplicate key errors**: Projects with same name already exist (should be handled)

### Log Files

Check `backfill_projects.log` for detailed execution logs and error information.

### Manual Verification

After running, verify success with:

```sql
-- Check that campaigns now have project IDs
SELECT id, title, "projectName", "projectId" 
FROM campaigns 
WHERE "projectName" IS NOT NULL AND "projectId" IS NOT NULL;

-- Check created projects
SELECT id, name, "createdAt" 
FROM projects 
ORDER BY "createdAt" DESC;
```
