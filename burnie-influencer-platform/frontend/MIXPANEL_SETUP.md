# Mixpanel Setup Guide

## Environment Variables

Add the following environment variable to your `.env.local` file:

```bash
NEXT_PUBLIC_MIXPANEL_TOKEN=your_mixpanel_project_token_here
```

## Getting Your Mixpanel Token

1. Go to [Mixpanel](https://mixpanel.com) and create an account
2. Create a new project
3. Go to Project Settings → Project Details
4. Copy the "Project Token"
5. Add it to your environment variables

## Development vs Production

The Mixpanel service is configured to:
- Show debug logs in development mode
- Hide debug logs in production mode
- Use localStorage for persistence

## Events Being Tracked

### Homepage (Unauthenticated Marketplace)
The homepage (`/` route) serves as an unauthenticated marketplace where users can browse content without logging in. The same `BiddingInterface` component is used, but with additional context tracking:

- **`marketplaceViewed`** - Tracks when users view the homepage marketplace (with `screenName: 'Homepage'` and `marketplaceType: 'unauthenticated'`)
- **`contentItemViewed`** - Tracks when unauthenticated users click on content items (with `screenName: 'Homepage'`)
- **`contentSearchPerformed`** - Tracks searches performed by unauthenticated users (with `screenName: 'Homepage'`)
- **`contentFilterApplied`** - Tracks filters applied by unauthenticated users (with `screenName: 'Homepage'`)
- **`purchaseModalOpened`** - Tracks when unauthenticated users try to purchase (triggers auth flow)
- **`errorOccurred`** - Tracks when unauthenticated users attempt purchases (with `errorType: 'authentication_required'`)

All events include additional properties:
- `screenName`: 'Homepage' (for homepage) | 'Marketplace' (for authenticated marketplace)
- `marketplaceType`: 'authenticated' | 'unauthenticated'
- `userAuthenticated`: boolean

### Authentication Events
- `walletConnected` - When user connects wallet
- `userAuthenticated` - When user completes signature verification
- `marketplaceAccessGranted` - When user gains access to marketplace

### Content Discovery Events
- `marketplaceViewed` - When user views marketplace (includes homepage unauthenticated marketplace)
- `contentItemViewed` - When user clicks on content item (includes homepage unauthenticated marketplace)
- `contentSearchPerformed` - When user searches for content (includes homepage unauthenticated marketplace)
- `contentFilterApplied` - When user applies filters (includes homepage unauthenticated marketplace)

### Purchase Flow Events
- `purchaseModalOpened` - When purchase modal opens (includes homepage unauthenticated marketplace)
- `currencyToggleClicked` - When user toggles ROAST/USDC
- `purchaseInitiated` - When user starts purchase
- `purchaseCompleted` - When purchase completes successfully
- `purchaseFailed` - When purchase fails
- `purchaseCancelled` - When user cancels purchase
- `chooseYapperContentGenerated` - When content is generated via Choose Yapper flow
- `myVoiceContentGenerated` - When content is generated via My Voice flow

### Content Management Events
- `myContentViewed` - When user views their content
- `contentPreviewOpened` - When user opens content preview
- `contentDownloaded` - When user downloads content
- `myContentSearchPerformed` - When user searches within their content
- `myContentFilterApplied` - When user applies filters in My Content

### Twitter Integration Events
- `tweetPreviewOpened` - When tweet preview modal opens
- `twitterConnectClicked` - When user clicks to connect Twitter
- `twitterConnected` - When Twitter connection succeeds
- `tweetPosted` - When tweet is posted successfully
- `tweetPostFailed` - When tweet posting fails
- `tweetContentCopied` - When user copies tweet content

### Navigation Events
- ~~`pageViewed` - Automatic page view tracking~~ **REMOVED** - Using specific event tracking instead
- `mobileBottomNavClicked` - Mobile navigation clicks
- `referralCodeCopied` - When user copies referral code

### Error Events
- `errorOccurred` - General error tracking
- `apiError` - API error tracking

## User Properties

The following user properties are automatically tracked and updated:

- `$wallet_address` - User's wallet address
- `$user_type` - Always "yapper"
- `$signup_date` - When user first connected
- `$total_content_purchased` - Total number of purchases
- `$total_spent_roast` - Total ROAST spent
- `$total_spent_usdc` - Total USDC spent
- `$last_active` - Last activity timestamp
- `$twitter_connected` - Whether Twitter is connected
- `$referral_code` - User's referral code

## Testing

To test Mixpanel integration:

1. Open browser developer tools
2. Look for console logs starting with "📊 Mixpanel event tracked:"
3. Check your Mixpanel dashboard for incoming events

## Privacy & GDPR

The implementation includes:
- User identification via wallet address
- Automatic event tracking with device type
- User property updates on key actions
- Error handling with graceful degradation

Make sure to comply with your local privacy regulations and obtain user consent if required.
