const { exec } = require('child_process');

// Test direct database query to see what's in pending status
const query = `
SELECT 
  id, 
  "twitterHandle", 
  "twitterFetchStatus", 
  "retryCount", 
  "maxRetries",
  "scheduledAt",
  "updatedAt",
  ("retryCount" < "maxRetries") as can_retry
FROM leaderboard_yapper_data 
WHERE "twitterFetchStatus" = 'pending' 
ORDER BY "priority" DESC, "createdAt" ASC 
LIMIT 5;
`;

exec(\`psql -h localhost -U postgres -d roastpower -c "\${query}"\`, (error, stdout, stderr) => {
  if (error) {
    console.error('Error:', error);
    return;
  }
  console.log('=== PENDING ITEMS DEBUG ===');
  console.log(stdout);
});
