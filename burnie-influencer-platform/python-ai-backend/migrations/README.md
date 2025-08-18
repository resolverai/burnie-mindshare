# ML Models Database Migration

This directory contains database migration scripts to fix and optimize the ML training tables.

## Files

- **`ml_models_fixes.sql`** - Pure SQL migration file
- **`run_ml_migrations.py`** - Python script that executes migrations using .env config
- **`requirements.txt`** - Python dependencies for the migration script

## Migration Contents

The migration includes these fixes:

1. **Missing Columns**: Added `llm_predicted_*` columns and crypto keyword counts
2. **Constraints**: Added unique constraints on `tweet_id` for both training tables
3. **Boolean Fixes**: Fixed NOT NULL constraints for `has_media`, `is_thread`, `is_reply`
4. **Data Cleanup**: Updated NULL values with proper defaults
5. **Indexes**: Added performance indexes for common queries
6. **Validation**: Cleaned up invalid data and recalculated derived fields

## Usage Options

### Option 1: Python Script (Recommended)

```bash
# Install dependencies
pip install -r migrations/requirements.txt

# Run migration (reads from .env automatically)
python run_ml_migrations.py
```

### Option 2: Manual SQL Execution

```bash
# Connect to your database
psql -h localhost -p 5434 -U postgres -d roastpower

# Execute migration
\i migrations/ml_models_fixes.sql
```

## What Gets Fixed

### Before Migration Issues:
- ❌ Missing `llm_predicted_snap_impact` column
- ❌ Missing `llm_predicted_position_impact` column  
- ❌ Missing `crypto_keyword_count` columns
- ❌ No unique constraints on `tweet_id`
- ❌ NULL values in boolean columns
- ❌ Invalid engagement counts

### After Migration:
- ✅ All required columns present
- ✅ Proper constraints prevent duplicates
- ✅ Clean data with proper defaults
- ✅ Performance indexes added
- ✅ Ready for ML model training

## Verification

The Python script automatically verifies:
- Tables exist
- Migration executes successfully  
- Pre/post migration statistics
- Data integrity

## Production Notes

- **Safe to run multiple times** - Uses `IF NOT EXISTS` and `ON CONFLICT DO NOTHING`
- **Non-destructive** - Only adds columns/constraints, doesn't delete data
- **Logged** - All operations logged to `ml_migration.log`
- **Rollback-friendly** - Most changes can be reverted if needed

## Support

If migration fails:
1. Check the log file: `ml_migration.log`
2. Verify database connection settings in `.env`
3. Ensure tables `primary_predictor_training_data` and `twitter_engagement_training_data` exist
