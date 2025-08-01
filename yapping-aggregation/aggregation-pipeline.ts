// Standalone MongoDB Aggregation Pipeline for Yapping Data
import mongoose from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

// Configuration interface
interface Config {
  mongodb: {
    uri: string;
    database: string;
  };
}

// Data interfaces
interface YapScoreEntry {
  author_id: string;
  totalContentScore: number;
  yaps_all: number;
  yaps_l24h: number;
  yaps_l48h: number;
  yaps_l7d: number;
  yaps_l30d: number;
  yaps_l3m: number;
  yaps_l6m: number;
  yaps_l12m: number;
  multiplierFactor: number;
  WhimsyYapScore: number;
  tweets: string[];
  username: string;
  created: Date;
  mindShare?: number;
  normalizedMindShare?: number;
}

// Load configuration
const loadConfig = (): Config => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error('Error loading config.json. Please ensure it exists and has valid MongoDB credentials.');
    console.error('Example config.json:');
    console.error(`{
  "mongodb": {
    "uri": "mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority",
    "database": "your_database_name"
  }
}`);
    process.exit(1);
  }
};

// MongoDB connection
const connectToDatabase = async (config: Config): Promise<void> => {
  try {
    await mongoose.connect(config.mongodb.uri, {
      dbName: config.mongodb.database,
    });
    console.log(`✅ Connected to MongoDB Atlas database: ${config.mongodb.database}`);
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error);
    process.exit(1);
  }
};

// Schema definition
const dailyYapScoresSchema = new mongoose.Schema(
  {
    author_id: { type: String, required: true },
    totalContentScore: { type: Number, default: 0 },
    created: { type: Date, default: Date.now },
    username: { type: String, required: true },
    tweets: [String],
    yaps_all: { type: Number, default: 0 },
    yaps_l24h: { type: Number, default: 0 },
    yaps_l48h: { type: Number, default: 0 },
    yaps_l7d: { type: Number, default: 0 },
    yaps_l30d: { type: Number, default: 0 },
    yaps_l3m: { type: Number, default: 0 },
    yaps_l6m: { type: Number, default: 0 },
    yaps_l12m: { type: Number, default: 0 },
    normalizedYaps7d: { type: Number, default: 0 },
    normalizedContentScore: { type: Number, default: 0 },
    WhimsyYapScore: { type: Number, default: 0 },
    mindShare: { type: Number, default: 0 },
    normalizedMindShare: { type: Number, default: 0 },
  },
  {
    collection: "DailyYapScores1",
    timestamps: true,
  }
);

const DailyYapScores = mongoose.model("DailyYapScores", dailyYapScoresSchema);

// Schema for aggregated results
const aggregatedResultsSchema = new mongoose.Schema(
  {
    author_id: { type: String, required: true },
    totalContentScore: { type: Number, required: true },
    yaps_all: { type: Number, required: true },
    yaps_l24h: { type: Number, required: true },
    yaps_l48h: { type: Number, required: true },
    yaps_l7d: { type: Number, required: true },
    yaps_l30d: { type: Number, required: true },
    yaps_l3m: { type: Number, required: true },
    yaps_l6m: { type: Number, required: true },
    yaps_l12m: { type: Number, required: true },
    multiplierFactor: { type: Number, required: true },
    WhimsyYapScore: { type: Number, required: true },
    tweets: [String],
    username: { type: String, required: true },
    created: { type: Date, required: true },
    mindShare: { type: Number, required: true },
    normalizedMindShare: { type: Number, required: true },
    aggregationDate: { type: Date, default: Date.now },
    dateRange: {
      start: { type: Date, required: true },
      end: { type: Date, required: true }
    }
  },
  {
    timestamps: true,
  }
);

// Function to get Monday of current week (or previous Monday if today is Monday)
const getMondayOfCurrentWeek = (): Date => {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  
  let daysToSubtract: number;
  
  if (dayOfWeek === 1) {
    // If today is Monday, use last Monday (7 days ago)
    daysToSubtract = 7;
  } else if (dayOfWeek === 0) {
    // If Sunday, go back 6 days to get last Monday
    daysToSubtract = 6;
  } else {
    // For Tuesday-Saturday, go back to current week's Monday
    daysToSubtract = dayOfWeek - 1;
  }
  
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysToSubtract);
  monday.setHours(0, 0, 0, 0); // Set to midnight
  
  return monday;
};

// Function to create collection name based on current week
const getCollectionName = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  
  return `AggregatedYapScores_${year}_${month}_${day}_${hours}${minutes}`;
};

// Function to save aggregated results to MongoDB
const saveAggregatedResults = async (results: YapScoreEntry[], startDate: Date, endDate: Date): Promise<string> => {
  const collectionName = getCollectionName();
  
  // Create dynamic model for the collection
  const AggregatedResults = mongoose.model(collectionName, aggregatedResultsSchema, collectionName);
  
  // Prepare documents with metadata
  const documentsToSave = results.map(entry => ({
    ...entry,
    aggregationDate: new Date(),
    dateRange: {
      start: startDate,
      end: endDate
    }
  }));
  
  try {
    // Clear existing data for today (if any)
    await AggregatedResults.deleteMany({});
    
    // Insert new aggregated data
    await AggregatedResults.insertMany(documentsToSave);
    
    console.log(`💾 Saved ${documentsToSave.length} records to collection: ${collectionName}`);
    return collectionName;
  } catch (error) {
    console.error('❌ Error saving aggregated results:', error);
    throw error;
  }
};

// Function to convert array to CSV string
const arrayToCSV = (data: any[]): string => {
  if (data.length === 0) return '';
  
  // Get headers from the first object
  const headers = Object.keys(data[0]);
  
  // Create CSV header row
  const csvHeaders = headers.join(',');
  
  // Create CSV data rows
  const csvRows = data.map(row => {
    return headers.map(header => {
      let value = row[header];
      
      // Handle different data types
      if (value === null || value === undefined) {
        value = '';
      } else if (typeof value === 'object') {
        if (Array.isArray(value)) {
          // Convert arrays to pipe-separated values
          value = value.join('|');
        } else if (value instanceof Date) {
          value = value.toISOString();
        } else {
          // Convert objects to JSON string
          value = JSON.stringify(value);
        }
      } else if (typeof value === 'string') {
        // Escape quotes and wrap in quotes if contains comma
        value = value.replace(/"/g, '""');
        if (value.includes(',') || value.includes('\n') || value.includes('"')) {
          value = `"${value}"`;
        }
      }
      
      return value;
    }).join(',');
  });
  
  return [csvHeaders, ...csvRows].join('\n');
};

// Function to save aggregated results to CSV
const saveAggregatedResultsToCSV = async (results: YapScoreEntry[], startDate: Date, endDate: Date): Promise<string> => {
  try {
    // Create csvs directory if it doesn't exist
    const csvsDir = path.join(__dirname, 'csvs');
    if (!fs.existsSync(csvsDir)) {
      fs.mkdirSync(csvsDir, { recursive: true });
      console.log('📁 Created csvs directory');
    }
    
    // Generate CSV filename with current date
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    const csvFileName = `AggregatedYapScores_${year}_${month}_${day}_${hours}${minutes}.csv`;
    const csvPath = path.join(csvsDir, csvFileName);
    
    // Prepare data for CSV (flatten the structure)
    const csvData = results.map((entry, index) => ({
      rank: index + 1,
      author_id: entry.author_id,
      username: entry.username,
      totalContentScore: entry.totalContentScore,
      multiplierFactor: Number(entry.multiplierFactor?.toFixed(4)) || 0,
      WhimsyYapScore: Number(entry.WhimsyYapScore?.toFixed(2)) || 0,
      mindShare: Number(((entry.mindShare || 0) * 100).toFixed(4)), // Convert to percentage
      normalizedMindShare: Number(((entry.normalizedMindShare || 0) * 100).toFixed(4)), // Convert to percentage
      yaps_all: entry.yaps_all,
      yaps_l24h: entry.yaps_l24h,
      yaps_l48h: entry.yaps_l48h,
      yaps_l7d: entry.yaps_l7d,
      yaps_l30d: entry.yaps_l30d,
      yaps_l3m: entry.yaps_l3m,
      yaps_l6m: entry.yaps_l6m,
      yaps_l12m: entry.yaps_l12m,
      tweets_count: Array.isArray(entry.tweets) ? entry.tweets.length : 0,
      tweets: Array.isArray(entry.tweets) ? entry.tweets.join('|') : '',
      created: entry.created instanceof Date ? entry.created.toISOString() : entry.created,
      aggregation_date: new Date().toISOString(),
      date_range_start: startDate.toISOString(),
      date_range_end: endDate.toISOString()
    }));
    
    // Convert to CSV
    const csvContent = arrayToCSV(csvData);
    
    // Write CSV file
    fs.writeFileSync(csvPath, csvContent, 'utf8');
    
    console.log(`📄 Saved CSV file: ${csvFileName} (${csvData.length} records)`);
    return csvFileName;
  } catch (error) {
    console.error('❌ Error saving CSV file:', error);
    throw error;
  }
};

// Original aggregation function (legacy)
const aggregateDailyYapScoresLog = async (startDate: Date, endDate: Date) => {
  return DailyYapScores.aggregate([
    {
      $match: {
        $expr: {
          $and: [
            {
              $gte: [
                { $dateFromString: { dateString: { $toString: "$created" } } },
                startDate,
              ],
            },
            {
              $lte: [
                { $dateFromString: { dateString: { $toString: "$created" } } },
                endDate,
              ],
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: "$author_id",
        totalContentScore: { $sum: "$totalContentScore" },
        yaps_all: { $sum: "$yaps_all" },
        yaps_l24h: { $sum: "$yaps_l24h" },
        yaps_l48h: { $sum: "$yaps_l48h" },
        yaps_l7d: { $sum: "$yaps_l7d" },
        yaps_l30d: { $sum: "$yaps_l30d" },
        yaps_l3m: { $sum: "$yaps_l3m" },
        yaps_l6m: { $sum: "$yaps_l6m" },
        yaps_l12m: { $sum: "$yaps_l12m" },
        normalizedYaps7d: { $sum: "$normalizedYaps7d" },
        normalizedContentScore: { $sum: "$normalizedContentScore" },
        WhimsyYapScore: { $sum: "$WhimsyYapScore" },
        tweets: { $push: "$tweets" },
        username: { $first: "$username" },
        created: { $first: "$created" },
      },
    },
    {
      $project: {
        author_id: "$_id",
        _id: 0,
        totalContentScore: 1,
        yaps_all: 1,
        yaps_l24h: 1,
        yaps_l48h: 1,
        yaps_l7d: 1,
        yaps_l30d: 1,
        yaps_l3m: 1,
        yaps_l6m: 1,
        yaps_l12m: 1,
        normalizedYaps7d: 1,
        normalizedContentScore: 1,
        WhimsyYapScore: 1,
        tweets: {
          $reduce: {
            input: "$tweets",
            initialValue: [],
            in: { $concatArrays: ["$$value", "$$this"] },
          },
        },
        username: 1,
        created: 1,
      },
    },
  ]);
};

// Main aggregation function with multiplier
export const aggregateDailyYapScoresMultiplier = async (startDate: Date, endDate: Date) => {
    return DailyYapScores.aggregate([
      // 1️⃣ Filter by created date range
      {
        $match: {
          $expr: {
            $and: [
              {
                $gte: [
                  { $dateFromString: { dateString: { $toString: "$created" } } },
                  startDate,
                ],
              },
              {
                $lte: [
                  { $dateFromString: { dateString: { $toString: "$created" } } },
                  endDate,
                ],
              },
            ],
          },
        },
      },
  
      // 2️⃣ Group by author_id and sum values
      {
        $group: {
          _id: "$author_id",
          totalContentScore: { $sum: "$totalContentScore" },
          yaps_all: { $sum: "$yaps_all" },
          yaps_l24h: { $sum: "$yaps_l24h" },
          yaps_l48h: { $sum: "$yaps_l48h" },
          yaps_l7d: { $last: "$yaps_l7d" },
          yaps_l30d: { $sum: "$yaps_l30d" },
          yaps_l3m: { $sum: "$yaps_l3m" },
          yaps_l6m: { $sum: "$yaps_l6m" },
          yaps_l12m: { $sum: "$yaps_l12m" },
          tweets: { $push: "$tweets" },
          username: { $first: "$username" },
          created: { $first: "$created" },
        },
      },
  
      // 3️⃣ wipe any stale normals
      { $unset: ["normalizedYaps7d", "normalizedContentScore", "WhimsyYapScore"] },
      
  
      // 4️⃣ Calculate multiplierFactor
      {
        $addFields: {
          multiplierFactor: {
            $add: [
              1,
              { $divide: ["$yaps_l7d", 100] }
            ]
          }
        }
      },
  
       // 5️⃣ Compute final WhimsyYapScoreWithNormalisation
       {
        $addFields: {
          WhimsyYapScore: {
            $multiply: ["$totalContentScore", "$multiplierFactor"]
          },
        },
      },
  
      // 6️⃣ Final shape
      {
        $project: {
          _id: 0,
          author_id: "$_id",
          totalContentScore: 1,
          yaps_all: 1,
          yaps_l24h: 1,
          yaps_l48h: 1,
          yaps_l7d: 1,
          yaps_l30d: 1,
          yaps_l3m: 1,
          yaps_l6m: 1,
          yaps_l12m: 1,
          multiplierFactor: 1,
          // normalizedYaps7d: 1,
          // normalizedContentScore: 1,
          WhimsyYapScore: 1,
          tweets: {
            $reduce: {
              input: "$tweets",
              initialValue: [],
              in: { $concatArrays: ["$$value", "$$this"] },
            },
          },
          username: 1,
          created: 1,
        },
      },
    ]);
};

// Standalone function to run the aggregation
const runAggregation = async (startDate: Date, endDate: Date) => {
  try {
    // Calculate the duration
    const duration = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`🔄 Running weekly aggregation (${duration} days of data)`);
    console.log(`📅 From: ${startDate.toISOString()}`);
    console.log(`📅 To: ${endDate.toISOString()}`);
    
    // Get aggregated data
    let aggregatedData: YapScoreEntry[] = await aggregateDailyYapScoresMultiplier(startDate, endDate);
    console.log(`📊 Found ${aggregatedData.length} records from current week`);

    if (aggregatedData.length > 0) {
      console.log("📈 Sample record:", JSON.stringify(aggregatedData[0], null, 2));
    }

    // Sort by WhimsyYapScore to get top 100 and top 25
    aggregatedData.sort(
      (a: YapScoreEntry, b: YapScoreEntry) => (b.WhimsyYapScore || 0) - (a.WhimsyYapScore || 0)
    );
    const top100 = aggregatedData.slice(0, 100);
    const top25 = aggregatedData.slice(0, 25);

    // Calculate total scores
    const totalTop100Score = top100.reduce(
      (sum: number, entry: YapScoreEntry) => sum + (entry.WhimsyYapScore || 0),
      0
    );
    const totalTop25Score = top25.reduce(
      (sum: number, entry: YapScoreEntry) => sum + (entry.WhimsyYapScore || 0),
      0
    );

    // Calculate mindshare scores for all entries
    aggregatedData = aggregatedData.map((entry: YapScoreEntry) => ({
      ...entry,
      mindShare:
        totalTop100Score > 0
          ? (entry.WhimsyYapScore || 0) / totalTop100Score
          : 0,
      normalizedMindShare:
        totalTop25Score > 0 ? (entry.WhimsyYapScore || 0) / totalTop25Score : 0,
    }));

    const result = {
      leaderboard: aggregatedData,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      stats: {
        totalEntries: aggregatedData.length,
        totalTop100Score,
        totalTop25Score,
        averageMindShare: totalTop100Score ? 1 / top100.length : 0,
        averageNormalizedMindShare: totalTop25Score ? 1 / 25 : 0,
      },
    };

    console.log('🏆 Top 10 Results:');
    result.leaderboard.slice(0, 10).forEach((entry: YapScoreEntry, index: number) => {
      console.log(`${index + 1}. ${entry.username} - WhimsyYapScore: ${entry.WhimsyYapScore?.toFixed(2)} - MindShare: ${((entry.mindShare || 0) * 100)?.toFixed(2)}%`);
    });

    console.log('\n📊 Statistics:');
    console.log(`Total entries: ${result.stats.totalEntries}`);
    console.log(`Total Top 100 Score: ${result.stats.totalTop100Score.toFixed(2)}`);
    console.log(`Total Top 25 Score: ${result.stats.totalTop25Score.toFixed(2)}`);

    return result;
  } catch (error) {
    console.error("❌ Error in aggregation:", error);
    throw error;
  }
};

// Main function
const main = async () => {
  console.log('🚀 Starting Yapping Aggregation Pipeline...\n');
  
  // Load configuration
  const config = loadConfig();
  
  // Connect to database
  await connectToDatabase(config);
  
  try {
    // Set date range from Monday of current week to current time
    const startDate = getMondayOfCurrentWeek();
    const endDate = new Date(); // Current time
    
    const today = new Date().getDay();
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][today];
    const mondayType = today === 1 ? 'previous Monday' : 'current week Monday';
    
    console.log(`📅 Today is ${dayName}, using ${mondayType} as start date`);
    console.log(`📅 Aggregating data from: ${startDate.toISOString()}`);
    console.log(`📅 Until current time: ${endDate.toISOString()}`);
    
    // Run aggregation
    const result = await runAggregation(startDate, endDate);
    
    // Save results to MongoDB collection with current date
    const collectionName = await saveAggregatedResults(result.leaderboard, startDate, endDate);
    
    // Save results to CSV file
    const csvFileName = await saveAggregatedResultsToCSV(result.leaderboard, startDate, endDate);
    
    // Optional: Also save to JSON file if needed
    // fs.writeFileSync('aggregation-results.json', JSON.stringify(result, null, 2));
    
    console.log(`\n✅ Aggregation completed successfully!`);
    console.log(`📊 Results saved to MongoDB collection: ${collectionName}`);
    console.log(`📄 Results saved to CSV file: csvs/${csvFileName}`);
  } catch (error) {
    console.error('💥 Error during execution:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
};

// Run the script if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Unhandled error:', error);
    process.exit(1);
  });
}