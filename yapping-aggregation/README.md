# Yapping Aggregation Pipeline

A standalone TypeScript script to aggregate and analyze yapping data from MongoDB Atlas.

## Features

- 🚀 Standalone script that connects directly to MongoDB Atlas
- 📊 Calculates WhimsyYapScore with multiplier factors
- 🏆 Generates leaderboards and mindshare calculations
- 📈 Provides detailed statistics and top performers analysis
- 🔧 Easy configuration through JSON file

## Setup

### 1. Install Dependencies

```bash
# Using npm
npm install

# Using bun (faster)
bun install
```

### 2. Configure MongoDB Connection

Edit the `config.json` file with your MongoDB Atlas credentials:

```json
{
  "mongodb": {
    "uri": "mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority",
    "database": "your_database_name"
  }
}
```

**Important:** Replace the placeholders with your actual MongoDB Atlas credentials:
- `username`: Your MongoDB Atlas username
- `password`: Your MongoDB Atlas password
- `cluster.mongodb.net`: Your cluster URL
- `database`: Your database name

### 3. MongoDB Atlas Setup

Make sure your MongoDB Atlas database contains a collection called `DailyYapScores1` with documents that have the following structure:

```javascript
{
  author_id: String,
  totalContentScore: Number,
  created: Date,
  username: String,
  tweets: [String],
  yaps_all: Number,
  yaps_l24h: Number,
  yaps_l48h: Number,
  yaps_l7d: Number,
  yaps_l30d: Number,
  yaps_l3m: Number,
  yaps_l6m: Number,
  yaps_l12m: Number,
  // ... other fields
}
```

## Usage

### Run the Script

```bash
# Using npm
npm start

# Using ts-node directly
npx ts-node aggregation-pipeline.ts

# Using bun (faster)
bun run start
```

### Development Mode (with file watching)

```bash
npm run dev
```

## What the Script Does

1. **Connects to MongoDB Atlas** using the credentials from `config.json`
2. **Reads from collection** `DailyYapScores1` and aggregates data from **Monday start date** until **current time**
3. **Calculates multiplier factors** based on 7-day yapping activity
4. **Computes WhimsyYapScore** using: `totalContentScore × multiplierFactor`
5. **Generates mindshare scores** for top 100 and top 25 performers
6. **Saves results** to:
   - MongoDB collection with timestamp (e.g., `AggregatedYapScores_2024_01_15_1430`)
   - CSV file in `csvs/` folder with same name (e.g., `AggregatedYapScores_2024_01_15_1430.csv`)
7. **Displays results** including:
   - Top 10 leaderboard
   - Total statistics
   - MindShare percentages

## Output Example

```
🚀 Starting Yapping Aggregation Pipeline...

✅ Connected to MongoDB Atlas database: yapping_data
📅 Today is Friday, using current week Monday as start date
📅 Aggregating data from: 2024-01-08T00:00:00.000Z
📅 Until current time: 2024-01-12T14:30:15.123Z
🔄 Running weekly aggregation (5 days of data)
📅 From: 2024-01-08T00:00:00.000Z
📅 To: 2024-01-12T14:30:15.123Z
📊 Found 1250 records from current week

🏆 Top 10 Results:
1. alice_crypto - WhimsyYapScore: 1234.56 - MindShare: 2.45%
2. bob_defi - WhimsyYapScore: 1198.34 - MindShare: 2.38%
3. charlie_nft - WhimsyYapScore: 1156.78 - MindShare: 2.29%
...

📊 Statistics:
Total entries: 1250
Total Top 100 Score: 45678.90
Total Top 25 Score: 23456.78

💾 Saved 1250 records to collection: AggregatedYapScores_2024_01_12_1430
📄 Saved CSV file: AggregatedYapScores_2024_01_12_1430.csv (1250 records)

✅ Aggregation completed successfully!
📊 Results saved to MongoDB collection: AggregatedYapScores_2024_01_12_1430
📄 Results saved to CSV file: csvs/AggregatedYapScores_2024_01_12_1430.csv
🔌 Database connection closed
```

## Customization

### Date Range

The script automatically calculates the date range based on the current day of the week. 

**Current Logic:**
- **Start Date**: 
  - If **today is Monday**: Uses **previous Monday** at 00:00:00 (last week)
  - If **today is Tuesday-Sunday**: Uses **current week's Monday** at 00:00:00
- **End Date**: Current timestamp when script runs

**Example Scenarios:**
- **Monday**: Aggregates **previous Monday** 00:00 → Monday current time (7 days of data)
- **Tuesday**: Aggregates **current Monday** 00:00 → Tuesday current time (2 days of data)
- **Wednesday**: Aggregates **current Monday** 00:00 → Wednesday current time (3 days of data)  
- **Friday**: Aggregates **current Monday** 00:00 → Friday current time (5 days of data)

If you need to modify this behavior, edit the `main()` function in `aggregation-pipeline.ts`:

```typescript
// Current implementation
const startDate = getMondayOfCurrentWeek();
const endDate = new Date(); // Current time

// Custom date range example (uncomment and modify as needed)
// const startDate = new Date('2024-01-01T00:00:00.000Z');
// const endDate = new Date('2024-01-07T23:59:59.999Z');
```

### Save Results to File

Uncomment this line in the `main()` function to save results:

```typescript
fs.writeFileSync('aggregation-results.json', JSON.stringify(result, null, 2));
```

### Collection Name

To use a different collection name, modify the schema definition:

```typescript
{
  collection: "YourCollectionName",
  timestamps: true,
}
```

## Troubleshooting

### Connection Issues

- ✅ Verify your MongoDB Atlas credentials in `config.json`
- ✅ Ensure your IP address is whitelisted in MongoDB Atlas
- ✅ Check that your cluster is running and accessible

### No Data Found

- ✅ Verify the collection name is correct (`DailyYapScores1`)
- ✅ Check that documents exist in the specified date range
- ✅ Ensure the `created` field format matches the aggregation query

### Results Storage

**MongoDB Collections:**
- ✅ Results are automatically saved to a collection named `AggregatedYapScores_YYYY_MM_DD_HHMM`
- ✅ Each run creates a new collection with timestamp (no overwriting)
- ✅ Collections contain weekly aggregation data from Monday of current week to run time
- ✅ You can query these collections to extract historical weekly aggregation data

**CSV Files:**
- ✅ CSV files are saved in the `csvs/` folder with timestamp: `AggregatedYapScores_YYYY_MM_DD_HHMM.csv`
- ✅ Each run creates a new CSV file (doesn't overwrite)
- ✅ CSV and MongoDB collection names are identical for easy correlation
- ✅ CSV includes all metrics plus additional calculated fields:
  - `rank` - Position in leaderboard (1, 2, 3...)
  - `mindShare` - Percentage of top 100 mindshare
  - `normalizedMindShare` - Percentage of top 25 mindshare
  - `tweets_count` - Number of tweets
  - `tweets` - All tweets separated by pipes (|)
  - Date range and aggregation metadata

### TypeScript Errors

- ✅ Run `npm install` or `bun install` to install dependencies
- ✅ Ensure you have Node.js and TypeScript installed

## Dependencies

- **mongoose**: MongoDB object modeling library
- **typescript**: TypeScript compiler
- **ts-node**: TypeScript execution environment
- **@types/node**: Node.js type definitions

## License

MIT 