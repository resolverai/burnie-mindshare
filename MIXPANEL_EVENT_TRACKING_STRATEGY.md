# Mixpanel Event Tracking Strategy - Yapper Platform

## Overview
This document outlines the focused event tracking strategy for the Yapper platform using Mixpanel. The focus is on tracking user interactions across the **Yapper Dashboard only** - specifically the authenticated marketplace (BiddingInterface), My Content screen, PurchaseContentModal, and TweetPreviewModal. **Admin dashboard and mining interface are excluded**.

## Mixpanel Setup

### Project Token
- **Environment**: Production
- **Token**: `YOUR_PROJECT_TOKEN` (to be configured)
- **Debug Mode**: Enabled for development, disabled for production

### Configuration
```javascript
mixpanel.init('YOUR_PROJECT_TOKEN', {
  debug: process.env.NODE_ENV === 'development',
  track_pageview: true,
  persistence: 'localStorage'
});
```

## User Identification Strategy

### User Identification
- **Primary ID**: Wallet address (lowercase, normalized)
- **Secondary ID**: User ID from database (if available)
- **Fallback**: Session ID for anonymous users

### User Properties (Super Properties)
```javascript
mixpanel.people.set({
  $wallet_address: '0x1234...',
  $user_type: 'yapper', // yapper only (admin/miner excluded)
  $signup_date: '2025-01-13T10:30:00Z',
  $total_content_purchased: 0,
  $total_spent_roast: 0,
  $total_spent_usdc: 0,
  $preferred_content_types: ['text', 'visual'],
  $campaign_categories: ['crypto', 'tech'],
  $last_active: new Date().toISOString(),
  $twitter_connected: false,
  $referral_code: null
});
```

## Event Categories

### 1. Authentication & Onboarding

#### Events
- **`walletConnected`**
  - **Trigger**: When user connects wallet
  - **Properties**:
    - `walletType`: 'metamask', 'walletconnect', etc.
    - `walletAddress`: user's wallet address (normalized)
    - `connectionMethod`: 'manual', 'auto'
    - `previousConnection`: boolean
    - `chainId`: blockchain chain ID
    - `deviceType`: 'mobile', 'desktop'

- **`userAuthenticated`**
  - **Trigger**: When user completes signature verification
  - **Properties**:
    - `authenticationMethod`: 'signature_verification'
    - `signatureTime`: time taken to complete signature
    - `isFirstTime`: boolean
    - `referralCode`: referral code if used

- **`marketplaceAccessGranted`**
  - **Trigger**: When user gains access to authenticated marketplace
  - **Properties**:
    - `accessMethod`: 'direct_approval', 'referral_code', 'waitlist_approval'
    - `referralCode`: referral code if used
    - `waitlistPosition`: position in waitlist if applicable

### 2. Content Discovery & Browsing (BiddingInterface)

#### Events
- **`marketplaceViewed`**
  - **Trigger**: User views authenticated marketplace
  - **Properties**:
    - `contentCount`: number of items displayed
    - `hasActiveFilters`: boolean
    - `sortMethod`: 'bidding_enabled', 'mindshare', 'quality', 'price_low', 'price_high', 'newest'
    - `sortOrder`: 'asc', 'desc'
    - `screenName`: 'BiddingInterface'
    - `deviceType`: 'mobile', 'desktop'

- **`contentItemViewed`**
  - **Trigger**: User clicks on content item (opens PurchaseContentModal)
  - **Properties**:
    - `contentId`: unique content identifier
    - `contentType`: 'text', 'visual'
    - `campaignId`: associated campaign
    - `contentPrice`: price in ROAST tokens
    - `contentMindshare`: predicted mindshare score
    - `contentQuality`: predicted quality score
    - `campaignTitle`: campaign title
    - `platformSource`: platform source
    - `projectName`: project name
    - `screenName`: 'BiddingInterface'
    - `deviceType`: 'mobile', 'desktop'

- **`contentSearchPerformed`**
  - **Trigger**: User types in search box (debounced after 500ms)
  - **Properties**:
    - `searchQuery`: search terms
    - `resultsCount`: number of results returned
    - `searchTime`: time taken to perform search
    - `screenName`: 'BiddingInterface'
    - `deviceType`: 'mobile', 'desktop'

- **`contentFilterApplied`**
  - **Trigger**: User applies platform/project/postType filters
  - **Properties**:
    - `filterType`: 'platform', 'project', 'postType'
    - `filterValue`: selected filter value
    - `resultsCount`: number of results after filtering
    - `previousFilterValue`: previously selected value
    - `screenName`: 'BiddingInterface'
    - `deviceType`: 'mobile', 'desktop'


### 3. Content Purchase Flow (PurchaseContentModal)

#### Events
- **`purchaseModalOpened`**
  - **Trigger**: User opens PurchaseContentModal
  - **Properties**:
    - `contentId`: content being purchased
    - `contentType`: 'text', 'visual'
    - `contentPrice`: price in ROAST tokens
    - `campaignId`: associated campaign
    - `modalSource`: 'marketplace', 'homepage', 'myContent'
    - `userBalance`: user's ROAST token balance
    - `userUSDCBalance`: user's USDC balance
    - `screenName`: 'PurchaseContentModal'
    - `deviceType`: 'mobile', 'desktop'

- **`currencyToggleClicked`**
  - **Trigger**: User toggles between ROAST/USDC pricing
  - **Properties**:
    - `contentId`: content being purchased
    - `selectedCurrency`: 'ROAST', 'USDC'
    - `roastPrice`: price in ROAST tokens
    - `usdcPrice`: price in USDC
    - `conversionRate`: ROAST to USDC rate
    - `screenName`: 'PurchaseContentModal'
    - `deviceType`: 'mobile', 'desktop'

- **`purchaseInitiated`**
  - **Trigger**: User clicks purchase button
  - **Properties**:
    - `contentId`: content being purchased
    - `contentType`: 'text', 'visual'
    - `selectedCurrency`: 'ROAST', 'USDC'
    - `purchasePrice`: price being paid
    - `campaignId`: associated campaign
    - `userBalance`: user's token balance
    - `purchaseMethod`: 'wallet_transfer'
    - `screenName`: 'PurchaseContentModal'
    - `deviceType`: 'mobile', 'desktop'

- **`purchaseCompleted`**
  - **Trigger**: Purchase successfully completed
  - **Properties**:
    - `contentId`: content purchased
    - `contentType`: 'text', 'visual'
    - `purchasePrice`: price paid
    - `selectedCurrency`: 'ROAST', 'USDC'
    - `campaignId`: associated campaign
    - `transactionHash`: blockchain transaction hash
    - `purchaseTime`: time taken to complete purchase
    - `userTotalPurchases`: total purchases by user (increment by 1)
    - `userTotalSpent`: total amount spent by user (increment by purchase price)
    - `screenName`: 'PurchaseContentModal'
    - `deviceType`: 'mobile', 'desktop'

- **`purchaseFailed`**
  - **Trigger**: Purchase fails
  - **Properties**:
    - `contentId`: content attempted to purchase
    - `failureReason`: 'insufficient_funds', 'transaction_failed', 'network_error', 'user_rejected'
    - `errorMessage`: specific error details
    - `selectedCurrency`: 'ROAST', 'USDC'
    - `retryAttempted`: boolean
    - `screenName`: 'PurchaseContentModal'
    - `deviceType`: 'mobile', 'desktop'

- **`purchaseCancelled`**
  - **Trigger**: User cancels purchase (closes modal without completing)
  - **Properties**:
    - `contentId`: content being purchased
    - `cancellationStage`: 'modal_opened', 'payment_initiated', 'confirmation'
    - `timeInFlow`: time spent in purchase flow
    - `selectedCurrency`: 'ROAST', 'USDC'
    - `screenName`: 'PurchaseContentModal'
    - `deviceType`: 'mobile', 'desktop'

- **`chooseYapperContentGenerated`**
  - **Trigger**: User successfully generates content using "Choose Yapper" flow
  - **Properties**:
    - `contentId`: content being purchased
    - `contentType`: 'text', 'visual'
    - `campaignId`: associated campaign
    - `generationTime`: time taken to generate content
    - `generatedContentLength`: character count of generated content
    - `screenName`: 'PurchaseContentModal'
    - `deviceType`: 'mobile', 'desktop'

- **`myVoiceContentGenerated`**
  - **Trigger**: User successfully generates content using "My Voice" flow
  - **Properties**:
    - `contentId`: content being purchased
    - `contentType`: 'text', 'visual'
    - `campaignId`: associated campaign
    - `generationTime`: time taken to generate content
    - `generatedContentLength`: character count of generated content
    - `screenName`: 'PurchaseContentModal'
    - `deviceType`: 'mobile', 'desktop'

### 4. Content Management (My Content - YapperMyContent)

#### Events
- **`myContentViewed`**
  - **Trigger**: User views their purchased content
  - **Properties**:
    - `contentCount`: number of content items
    - `contentTypes`: array of content types
    - `totalMindshare`: sum of mindshare scores
    - `totalEarnings`: total earnings from content
    - `hasActiveFilters`: boolean
    - `searchQuery`: current search term if any
    - `screenName`: 'YapperMyContent'
    - `deviceType`: 'mobile', 'desktop'

- **`contentPreviewOpened`**
  - **Trigger**: User clicks preview button on content (opens TweetPreviewModal)
  - **Properties**:
    - `contentId`: content being previewed
    - `contentType`: 'text', 'visual'
    - `campaignId`: associated campaign
    - `acquisitionType`: 'bid', 'purchase'
    - `purchasePrice`: price paid
    - `currency`: 'ROAST', 'USDC'
    - `screenName`: 'YapperMyContent'
    - `deviceType`: 'mobile', 'desktop'

- **`contentDownloaded`**
  - **Trigger**: User downloads content
  - **Properties**:
    - `contentId`: content downloaded
    - `contentType`: 'text', 'visual'
    - `downloadFormat`: 'image', 'text', 'both'
    - `campaignId`: associated campaign
    - `screenName`: 'YapperMyContent'
    - `deviceType`: 'mobile', 'desktop'

- **`myContentSearchPerformed`**
  - **Trigger**: User searches within their content
  - **Properties**:
    - `searchQuery`: search terms
    - `resultsCount`: number of results returned
    - `searchTime`: time taken to perform search
    - `screenName`: 'YapperMyContent'
    - `deviceType`: 'mobile', 'desktop'

- **`myContentFilterApplied`**
  - **Trigger**: User applies filters in My Content
  - **Properties**:
    - `filterType`: 'platform', 'project', 'postType'
    - `filterValue`: selected filter value
    - `resultsCount`: number of results after filtering
    - `screenName`: 'YapperMyContent'
    - `deviceType`: 'mobile', 'desktop'

### 5. Content Preview & Twitter Integration (TweetPreviewModal)

#### Events
- **`tweetPreviewOpened`**
  - **Trigger**: User opens TweetPreviewModal
  - **Properties**:
    - `contentId`: content being previewed
    - `contentType`: 'text', 'visual'
    - `previewSource`: 'myContent', 'marketplace'
    - `contentPrice`: price of content
    - `acquisitionType`: 'bid', 'purchase'
    - `currency`: 'ROAST', 'USDC'
    - `screenName`: 'TweetPreviewModal'
    - `deviceType`: 'mobile', 'desktop'

- **`twitterConnectClicked`**
  - **Trigger**: User clicks to connect Twitter
  - **Properties**:
    - `contentId`: content being previewed
    - `connectSource`: 'tweetPreview'
    - `screenName`: 'TweetPreviewModal'
    - `deviceType`: 'mobile', 'desktop'

- **`twitterConnected`**
  - **Trigger**: User successfully connects Twitter
  - **Properties**:
    - `twitterUsername`: connected Twitter username
    - `connectTime`: time taken to connect
    - `connectSource`: 'tweetPreview'
    - `screenName`: 'TweetPreviewModal'
    - `deviceType`: 'mobile', 'desktop'

- **`tweetPosted`**
  - **Trigger**: User successfully posts tweet
  - **Properties**:
    - `contentId`: content being posted
    - `contentType`: 'text', 'visual'
    - `tweetUrl`: URL of posted tweet
    - `postTime`: time taken to post
    - `tweetLength`: character count of tweet
    - `hasImage`: boolean
    - `hasThread`: boolean
    - `screenName`: 'TweetPreviewModal'
    - `deviceType`: 'mobile', 'desktop'

- **`tweetPostFailed`**
  - **Trigger**: Tweet posting fails
  - **Properties**:
    - `contentId`: content attempted to post
    - `failureReason`: 'twitter_error', 'network_error', 'user_cancelled'
    - `errorMessage`: specific error details
    - `retryAttempted`: boolean
    - `screenName`: 'TweetPreviewModal'
    - `deviceType`: 'mobile', 'desktop'

- **`tweetContentCopied`**
  - **Trigger**: User copies tweet content to clipboard
  - **Properties**:
    - `contentId`: content being copied
    - `contentType`: 'text', 'visual'
    - `copyFormat`: 'text_only', 'with_image_url'
    - `screenName`: 'TweetPreviewModal'
    - `deviceType`: 'mobile', 'desktop'


### 6. Navigation & User Journey

#### Events
- **`pageViewed`**
  - **Trigger**: User views any page (automatic only)
  - **Properties**:
    - `pageName`: page identifier ('homepage', 'marketplace', 'myContent', 'portfolio', 'history')
    - `screenName`: screen identifier ('BiddingInterface', 'PurchaseContentModal', 'TweetPreviewModal', 'YapperMyContent', 'Homepage')
    - `pageUrl`: full URL
    - `referrer`: previous page
    - `sessionDuration`: time spent on previous page
    - `userAuthenticated`: boolean
    - `walletConnected`: boolean
    - `deviceType`: 'mobile', 'desktop'

- **`mobileBottomNavClicked`**
  - **Trigger**: User clicks mobile bottom navigation
  - **Properties**:
    - `destinationPage`: target page
    - `currentPage`: current page
    - `userAuthenticated`: boolean
    - `deviceType`: 'mobile'

- **`referralCodeCopied`**
  - **Trigger**: User copies their referral code
  - **Properties**:
    - `referralCode`: referral code copied
    - `copySource`: 'referralSection', 'profile'
    - `copySuccess`: boolean
    - `deviceType`: 'mobile', 'desktop'

### 7. Error Tracking

#### Events
- **`errorOccurred`**
  - **Trigger**: Any error occurs
  - **Properties**:
    - `errorType`: 'javascript', 'network', 'validation', 'wallet', 'twitter'
    - `errorMessage`: error details
    - `errorPage`: page where error occurred
    - `userAuthenticated`: boolean
    - `errorSeverity`: 'low', 'medium', 'high'
    - `deviceType`: 'mobile', 'desktop'

- **`apiError`**
  - **Trigger**: API call fails
  - **Properties**:
    - `apiEndpoint`: failed endpoint
    - `errorCode`: HTTP status code
    - `errorMessage`: API error message
    - `retryAttempted`: boolean
    - `requestType`: 'GET', 'POST', 'PUT', 'DELETE'
    - `deviceType`: 'mobile', 'desktop'


## Funnel Analysis

### 1. Content Purchase Funnel
```
marketplaceViewed → contentItemViewed → purchaseModalOpened → currencyToggleClicked → purchaseInitiated → purchaseCompleted → tweetPreviewOpened → tweetPosted
```

### 2. User Onboarding Funnel
```
walletConnected → userAuthenticated → marketplaceAccessGranted → marketplaceViewed → firstPurchaseCompleted
```

### 3. Twitter Integration Funnel
```
tweetPreviewOpened → twitterStatusChecked → twitterConnectClicked → twitterConnected → tweetPosted
```

## User Properties Updates

### Properties Updated on Purchase
- **`$total_content_purchased`**: Increment by 1 on `purchaseCompleted`
- **`$total_spent_roast`**: Increment by purchase price on `purchaseCompleted` (if ROAST)
- **`$total_spent_usdc`**: Increment by purchase price on `purchaseCompleted` (if USDC)
- **`$last_active`**: Update to current timestamp on any user action
- **`$preferred_content_types`**: Update based on purchased content types
- **`$campaign_categories`**: Update based on purchased content campaigns

### Properties Updated on Twitter Connection
- **`$twitter_connected`**: Set to true on `twitterConnected`
- **`$twitter_username`**: Set to connected username on `twitterConnected`

### Properties Updated on Referral
- **`$referral_code`**: Set to user's referral code on `marketplaceAccessGranted`

## Cohort Analysis

### User Cohorts
- **Signup Date**: Track user behavior by signup month
- **First Purchase Date**: Track behavior by first purchase month
- **Content Type Preference**: Track behavior by preferred content type
- **Spending Level**: Track behavior by spending tier (ROAST/USDC)
- **Twitter Integration**: Track behavior by Twitter connection status

### Retention Metrics
- **Day 1 Retention**: Users who return the day after first visit
- **Day 7 Retention**: Users who return within 7 days
- **Day 30 Retention**: Users who return within 30 days
- **Purchase Retention**: Users who make repeat purchases
- **Twitter Retention**: Users who post tweets after purchase

## Implementation Priority

### Phase 1 (Critical)
1. User identification and authentication events (`walletConnected`, `userAuthenticated`)
2. Content purchase flow events (`purchaseModalOpened`, `purchaseCompleted`, `purchaseFailed`)
3. Basic page view tracking (`pageViewed`)
4. Error tracking (`errorOccurred`, `apiError`)

### Phase 2 (Important)
1. Content discovery and browsing events (`marketplaceViewed`, `contentItemViewed`, `contentSearchPerformed`)
2. Twitter integration events (`twitterConnected`, `tweetPosted`)
3. Navigation tracking (`mobileBottomNavClicked`)
4. Content management events (`myContentViewed`, `contentPreviewOpened`)

### Phase 3 (Nice to Have)
1. Advanced funnel analysis
2. Cohort analysis
3. Detailed user journey tracking
4. Content generation flows (`chooseYapperContentGenerated`, `myVoiceContentGenerated`)

## Data Privacy & Compliance

### GDPR Compliance
- User consent tracking
- Data retention policies
- Right to be forgotten implementation
- Data anonymization for analytics

### Data Retention
- **User Events**: 2 years
- **Purchase Data**: 7 years (tax compliance)
- **Error Logs**: 90 days
- **Session Data**: 30 days

## Success Metrics

### Key Performance Indicators (KPIs)
1. **Purchase Conversion Rate**: `purchaseModalOpened` → `purchaseCompleted`
2. **Twitter Integration Rate**: `tweetPreviewOpened` → `tweetPosted`
3. **User Retention**: Day 1, 7, 30 retention rates
4. **Average Order Value**: Average purchase amount (ROAST/USDC)
5. **Content Engagement**: Time spent viewing content
6. **User Lifetime Value**: Total spending per user
7. **Content Discovery**: Search and filter usage
8. **Error Rate**: Percentage of failed interactions

### Business Goals
1. **Increase Purchase Conversion**: 15% → 25%
2. **Improve User Retention**: 40% → 60% (Day 7)
3. **Increase Average Order Value**: 50 ROAST → 75 ROAST
4. **Reduce Purchase Abandonment**: 30% → 15%
5. **Increase Twitter Integration**: 20% → 40% (users who post tweets)
6. **Increase Content Discovery**: 60% → 80% (users who search/filter)

## Technical Implementation Notes

### Event Naming Convention
- Use camelCase for event names (as requested)
- Be descriptive but concise
- Include action verb (Viewed, Clicked, Completed)
- Group related events with prefixes

### Property Naming Convention
- Use camelCase for property names
- Be consistent across similar events
- Include units for numerical values
- Use boolean for yes/no values

### Event Timing
- Track events immediately when they occur
- Use debouncing for rapid-fire events (search: 500ms)
- Track duration for time-based events
- Include timestamps for all events

### Error Handling
- Graceful degradation if Mixpanel fails
- Retry logic for failed events
- Fallback to local storage for critical events
- Monitor Mixpanel service health

## Screen-Specific Implementation

### BiddingInterface (Authenticated Marketplace)
- `marketplaceViewed` - On component mount
- `contentItemViewed` - On content card click
- `contentSearchPerformed` - On search input (debounced)
- `contentFilterApplied` - On filter dropdown changes

### PurchaseContentModal
- `purchaseModalOpened` - On modal open
- `currencyToggleClicked` - On ROAST/USDC toggle
- `purchaseInitiated` - On purchase button click
- `purchaseCompleted` - On successful purchase
- `purchaseFailed` - On purchase failure
- `purchaseCancelled` - On modal close without purchase
- `chooseYapperContentGenerated` - On successful content generation via "Choose Yapper" flow
- `myVoiceContentGenerated` - On successful content generation via "My Voice" flow

### TweetPreviewModal
- `tweetPreviewOpened` - On modal open
- `twitterConnectClicked` - On Twitter connect button
- `twitterConnected` - On successful Twitter connection
- `tweetPosted` - On successful tweet post
- `tweetPostFailed` - On tweet post failure
- `tweetContentCopied` - On copy to clipboard

### YapperMyContent
- `myContentViewed` - On component mount
- `contentPreviewOpened` - On preview button click
- `contentDownloaded` - On download action
- `myContentSearchPerformed` - On search input (debounced)
- `myContentFilterApplied` - On filter changes

### Homepage (Unauthenticated Marketplace)
- `marketplaceViewed` - On component mount (unauthenticated)
- `contentItemViewed` - On content card click (opens modal)
- Same purchase flow events as authenticated marketplace

## Conclusion

This focused event tracking strategy provides comprehensive insights into user behavior across the Yapper Dashboard only. The strategy captures all critical user interactions including wallet connection, content discovery, purchase flows, Twitter integration, and content management.

The camelCase naming convention and focus on implemented features ensures accurate tracking of actual user behavior, providing actionable insights for improving the platform's core value proposition and user experience.
