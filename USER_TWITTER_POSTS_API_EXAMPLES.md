# User Twitter Posts API - Usage Examples

## 📝 **Overview**

The User Twitter Posts tracking system automatically stores all tweets posted through the platform and provides engagement metrics fetching capabilities.

## 🚀 **Automatic Tweet Tracking**

When users post tweets through the platform (PurchaseContentModal, TweetPreviewModal), the system automatically:

1. **Stores tweet data** in `user_twitter_posts` table
2. **Captures metadata** like post type, content ID, platform source
3. **Records tweet IDs** for main tweet and thread items
4. **Stores media information** if images are uploaded

## 📊 **API Endpoints**

### **1. Get User's Twitter Posts**

```http
GET /api/user-twitter-posts/{walletAddress}
```

**Query Parameters:**
- `refresh=true` - Fetch fresh engagement metrics from Twitter API

**Response:**
```json
{
  "success": true,
  "data": {
    "posts": [
      {
        "id": 123,
        "walletAddress": "0x1234...",
        "postType": "thread",
        "mainTweet": "This is my main tweet content...",
        "mainTweetId": "1234567890",
        "tweetThread": ["Second tweet in thread", "Third tweet in thread"],
        "imageUrl": "https://pbs.twimg.com/media/...",
        "engagementMetrics": {
          "1234567890": {
            "likes": 45,
            "retweets": 12,
            "replies": 8,
            "quotes": 3,
            "views": 1250,
            "last_updated": "2024-01-01T12:00:00Z"
          }
        },
        "totalEngagement": {
          "likes": 45,
          "retweets": 12,
          "replies": 8,
          "quotes": 3,
          "views": 1250
        },
        "postedAt": "2024-01-01T10:00:00Z",
        "contentId": 456,
        "platformSource": "PurchaseContentModal",
        "threadCount": 3,
        "tweetUrl": "https://twitter.com/i/web/status/1234567890",
        "content": {
          "id": 456,
          "contentText": "Original content text...",
          "predictedMindshare": 85.5,
          "qualityScore": 92.3
        }
      }
    ],
    "totalPosts": 1,
    "lastUpdated": "2024-01-01T12:00:00Z"
  }
}
```

### **2. Refresh Engagement Metrics**

```http
POST /api/user-twitter-posts/{walletAddress}/refresh-engagement
```

**Response:**
```json
{
  "success": true,
  "message": "Updated engagement metrics for 5 posts",
  "data": {
    "success": true,
    "updatedPosts": 5,
    "totalPosts": 5
  }
}
```

### **3. Get User Statistics**

```http
GET /api/user-twitter-posts/{walletAddress}/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalPosts": 25,
    "postTypes": {
      "shitpost": 15,
      "longpost": 5,
      "thread": 5
    },
    "totalEngagement": {
      "likes": 1250,
      "retweets": 340,
      "replies": 180,
      "quotes": 45,
      "views": 25000
    },
    "averageEngagement": {
      "likes": 50,
      "retweets": 14,
      "replies": 7,
      "quotes": 2,
      "views": 1000
    },
    "postsWithEngagement": 25,
    "lastPosted": "2024-01-01T12:00:00Z",
    "firstPosted": "2023-12-01T10:00:00Z"
  }
}
```

## 🎯 **Frontend Integration Examples**

### **My Content Page - Fetch Posts with Fresh Engagement**

```typescript
const fetchMyContent = async (walletAddress: string) => {
  try {
    const response = await fetch(
      `/api/user-twitter-posts/${walletAddress}?refresh=true`
    );
    const data = await response.json();
    
    if (data.success) {
      setUserPosts(data.data.posts);
      setTotalEngagement(data.data.posts.reduce((total, post) => ({
        likes: total.likes + post.totalEngagement.likes,
        retweets: total.retweets + post.totalEngagement.retweets,
        replies: total.replies + post.totalEngagement.replies,
        quotes: total.quotes + post.totalEngagement.quotes,
        views: total.views + post.totalEngagement.views
      }), { likes: 0, retweets: 0, replies: 0, quotes: 0, views: 0 }));
    }
  } catch (error) {
    console.error('Failed to fetch user posts:', error);
  }
};
```

### **Manual Engagement Refresh**

```typescript
const refreshEngagement = async (walletAddress: string) => {
  try {
    setLoading(true);
    const response = await fetch(
      `/api/user-twitter-posts/${walletAddress}/refresh-engagement`,
      { method: 'POST' }
    );
    const data = await response.json();
    
    if (data.success) {
      console.log(`Updated ${data.data.updatedPosts} posts`);
      // Refresh the posts list
      await fetchMyContent(walletAddress);
    }
  } catch (error) {
    console.error('Failed to refresh engagement:', error);
  } finally {
    setLoading(false);
  }
};
```

### **Display Post with Engagement**

```tsx
const PostCard = ({ post }: { post: UserTwitterPost }) => (
  <div className="bg-gray-800 rounded-lg p-4">
    <div className="flex justify-between items-start mb-2">
      <span className="text-sm text-gray-400">{post.postType}</span>
      <span className="text-xs text-gray-500">
        {new Date(post.postedAt).toLocaleDateString()}
      </span>
    </div>
    
    <p className="text-white mb-3">{post.mainTweet}</p>
    
    {post.tweetThread && (
      <div className="ml-4 border-l-2 border-gray-600 pl-3 mb-3">
        {post.tweetThread.map((tweet, index) => (
          <p key={index} className="text-gray-300 text-sm mb-1">{tweet}</p>
        ))}
      </div>
    )}
    
    <div className="flex justify-between items-center">
      <div className="flex space-x-4 text-sm text-gray-400">
        <span>❤️ {post.totalEngagement.likes}</span>
        <span>🔄 {post.totalEngagement.retweets}</span>
        <span>💬 {post.totalEngagement.replies}</span>
        <span>👁️ {post.totalEngagement.views}</span>
      </div>
      
      <a 
        href={post.tweetUrl} 
        target="_blank" 
        rel="noopener noreferrer"
        className="text-blue-400 hover:text-blue-300"
      >
        View on X →
      </a>
    </div>
  </div>
);
```

## 🔄 **Automatic Data Flow**

1. **Tweet Posted** → System stores post data automatically
2. **User visits My Content** → Fresh engagement metrics fetched from Twitter API
3. **Engagement displayed** → Real-time metrics shown to user
4. **Cached for 1 hour** → Subsequent visits use cached data unless manually refreshed

## 📈 **Post Type Classification**

- **`shitpost`**: Single tweets ≤ 280 characters
- **`longpost`**: Single tweets > 280 characters  
- **`thread`**: Multiple connected tweets

## 🔐 **Authentication**

All endpoints use wallet address for authentication:
- **Header**: `Authorization: Bearer {walletAddress}`
- **URL Parameter**: `{walletAddress}` in the endpoint path

## ⚡ **Performance Notes**

- **Batch Processing**: Twitter API calls are batched (100 tweets per request)
- **Rate Limiting**: 1-second delays between batches to respect Twitter limits
- **Caching**: Engagement data cached for 1 hour per post
- **Indexing**: Database indexed on wallet address and posting date for fast queries
