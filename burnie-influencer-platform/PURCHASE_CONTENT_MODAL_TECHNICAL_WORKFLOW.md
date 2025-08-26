# PurchaseContentModal - Technical Workflow Documentation

## Overview
The `PurchaseContentModal` is a comprehensive content marketplace interface that handles content discovery, AI generation, purchase, and Twitter posting in a single modal workflow.

## User Workflow Summary

### **Core Workflows**
1. **Content Discovery & Preview** - View existing marketplace content
2. **Content Generation** - Generate custom content using AI (Choose Yapper tab)
3. **Content Purchase** - Buy content with ROAST/USDC
4. **Post-Purchase Management** - Success screen and Twitter posting options

### **User Journey**
```
Browse → Select → Preview → Generate (optional) → Purchase → Success → Post to Twitter
```

## Technical Implementation

### **Modal State Management**
```typescript
// Key state variables
const [localContent, setLocalContent] = useState<ContentItem | null>(content)
const [isGeneratingContent, setIsGeneratingContent] = useState(false)
const [hasGeneratedContent, setHasGeneratedContent] = useState(false)
const [isPurchased, setIsPurchased] = useState(false)
const [showTweetManagement, setShowTweetManagement] = useState(false)
const [purchasedContentDetails, setPurchasedContentDetails] = useState(null)
```

### **Content Generation Flow (Choose Yapper Tab)**

#### **1. Generation Initiation**
- **Endpoint**: `POST /api/yapper-interface/generate-content`
- **Payload**: Campaign context, selected yapper, voice tone preferences
- **Response**: `executionId` for tracking

#### **2. Execution Tracking**
- **Polling**: `GET /api/execution/status/{executionId}` every 2 seconds
- **Status Flow**: `pending` → `completed` → `approved` → `biddable`
- **Content Loading**: `GET /api/marketplace/content/{contentId}`

#### **3. Props Changes During Generation**
```typescript
// Content prop changes trigger state updates
useEffect(() => {
  setLocalContent(content)
  setOriginalContent(content)
  // Reset generation state for new content
  setHasGeneratedContent(false)
  setGeneratedContent(null)
  setGenerationStatus('')
}, [content])
```

#### **4. Fresh Content Loading**
- **New content replaces existing content** in the modal
- **Modal stays open** with updated content
- **Generation state resets** for new content
- **Button changes** from "Generate Content" to "Buy Tweet"

### **Purchase Flow Differences**

#### **Buying Without Generation**
```typescript
// Direct purchase of existing marketplace content
const handlePurchase = async () => {
  // Skip generation, go directly to purchase
  // Content already available in localContent
  // Purchase flow proceeds normally
}
```

#### **Buying With Generation**
```typescript
// Purchase of newly generated content
const handlePurchase = async () => {
  if (hasGeneratedContent) {
    // Use generated content for purchase
    // Content is fresh and customized
    // Purchase flow proceeds with new content
  } else {
    // Generate content first
    await generateContentFromYapper()
  }
}
```

### **Race Condition Prevention System**

#### **Purpose**
- **Prevent double spending** on the same content
- **Avoid multiple users purchasing** simultaneously
- **Ensure content availability** during purchase flow
- **Handle transaction failures** gracefully

#### **Implementation**

##### **1. Purchase Flow Lock**
```typescript
// Database fields added to content_marketplace table
inPurchaseFlow: boolean           // Content locked in purchase
purchaseFlowInitiatedBy: string   // Wallet address of buyer
purchaseFlowInitiatedAt: Date     // When purchase started
purchaseFlowExpiresAt: Date       // Auto-release timeout
```

##### **2. Availability Check**
- **Endpoint**: `POST /api/marketplace/content/:id/check-availability`
- **Called before wallet opens** to prevent race conditions
- **Sets purchase flow lock** for the requesting user
- **Returns error** if content already in purchase flow

##### **3. Purchase Flow Release**
- **Endpoint**: `POST /api/marketplace/content/:id/release-purchase-flow`
- **Called when modal closes** or purchase fails
- **Releases lock** for other users
- **Auto-cleanup** every 5 minutes for expired flows

##### **4. Background Cleanup Service**
```typescript
// Runs every 5 minutes in TypeScript backend
const startPurchaseFlowCleanup = () => {
  setInterval(async () => {
    // Find expired purchase flows
    const expiredFlows = await contentRepository
      .createQueryBuilder('content')
      .where('content.inPurchaseFlow = :inPurchaseFlow', { inPurchaseFlow: true })
      .andWhere('content.purchaseFlowExpiresAt < :now', { now: new Date() })
      .getMany();
    
    // Reset expired flows
    for (const content of expiredFlows) {
      content.inPurchaseFlow = false;
      content.purchaseFlowInitiatedBy = null;
      content.purchaseFlowInitiatedAt = null;
      content.purchaseFlowExpiresAt = null;
      await contentRepository.save(content);
    }
  }, 5 * 60 * 1000);
};
```

### **API Endpoints Used**

#### **Content Generation**
- `POST /api/yapper-interface/generate-content` - Start generation
- `GET /api/execution/status/{executionId}` - Track progress
- `GET /api/marketplace/content/{contentId}` - Load generated content

#### **Content Approval & Bidding**
- `POST /api/marketplace/approve-content` - Approve and watermark
- `PUT /api/marketplace/content/:id/bidding` - Enable bidding

#### **Purchase Flow**
- `POST /api/marketplace/content/:id/check-availability` - Check availability
- `POST /api/marketplace/purchase` - Create purchase record
- `POST /api/marketplace/purchase/:id/confirm` - Confirm purchase
- `POST /api/marketplace/content/:id/release-purchase-flow` - Release lock

#### **Content Management**
- `POST /api/marketplace/content/:id/refresh-urls` - Refresh presigned URLs
- `GET /api/marketplace/check-balance` - Check user balance

### **State Persistence Strategy**

#### **Purchase Success State**
```typescript
// Store purchase details independently of content
const [purchasedContentDetails, setPurchasedContentDetails] = useState({
  id: number;
  title: string;
  price: number;
  currency: string;
  transactionHash: string;
})
```

#### **Modal Persistence**
- **Modal stays open** even if content becomes unavailable
- **Purchase states preserved** during content updates
- **Success screen shown** regardless of content availability
- **User can close manually** when ready

### **Error Handling & Recovery**

#### **Generation Failures**
- **Error messages displayed** to user
- **Generation state reset** for retry
- **Modal remains open** for troubleshooting

#### **Purchase Failures**
- **Transaction rollback** if confirmation fails
- **Content availability restored** automatically
- **User notified** of failure with transaction hash

#### **Network Issues**
- **Retry mechanisms** for API calls
- **Graceful degradation** of features
- **User feedback** for all operations

## Key Benefits

1. **Single Interface** - Complete content lifecycle in one modal
2. **Race Condition Prevention** - No double spending or conflicts
3. **State Persistence** - Modal stays open through content changes
4. **Error Recovery** - Automatic cleanup and user notification
5. **Flexible Workflows** - Support for both existing and generated content
