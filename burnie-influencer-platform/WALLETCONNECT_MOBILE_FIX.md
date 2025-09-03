# WalletConnect Mobile Wallet Connection Fix

## Problem Description
Users on mobile devices are experiencing "Invalid app configuration" errors when trying to connect wallets through WalletConnect in RainbowKit. This prevents them from using MetaMask, Uniswap Wallet, and other mobile wallets.

## Root Causes
1. **Missing WalletConnect Project Metadata**: The WalletConnect project needs proper metadata configuration
2. **Mobile Deep Linking Issues**: Mobile wallets require proper deep linking configuration
3. **Z-index Conflicts**: WalletConnect modals may have z-index conflicts on mobile
4. **Project Configuration**: The WalletConnect cloud project may not be properly configured

## Solutions Implemented

### 1. Enhanced WalletConnect Configuration
- Added proper metadata configuration in `walletConnectInit.ts`
- Configured mobile-specific settings for better compatibility
- Added proper z-index management for modals

### 2. Mobile Deep Linking Fixes
- Implemented proper deep linking for mobile wallets
- Fixed window.open behavior for wallet URLs
- Added mobile user agent detection

### 3. CSS Styling Fixes
- Added WalletConnect v2 modal styling in `globals.css`
- Fixed z-index conflicts
- Applied consistent theme colors

### 4. Initialization Script
- Created `walletConnectInit.ts` utility
- Automatically initializes WalletConnect on app load
- Applies mobile compatibility fixes

## Required Actions

### 1. Update WalletConnect Cloud Project
Go to [WalletConnect Cloud](https://cloud.walletconnect.com/) and update your project:

**Project Settings:**
- Name: `Burnie - Yapper Platform`
- Description: `AI-powered content marketplace for yappers and content creators`
- URL: `https://burnie.co`
- Icon: Upload your app icon
- Verify URL: `https://burnie.co`

**Redirect URLs:**
- Add: `burnie://`
- Add: `https://burnie.co`

**Mobile App Configuration:**
- Enable deep linking
- Add your app's bundle identifier if you have a native app

### 2. Environment Variables
Ensure your `.env` file has:
```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=05882002bee82f700cdbcfb99c981fdd
```

### 3. Test the Fix
1. Clear browser cache and cookies
2. Try connecting with WalletConnect on mobile
3. Select MetaMask or Uniswap Wallet
4. Should now work without "Invalid app configuration" error

## Technical Details

### Files Modified
- `src/utils/walletConnectInit.ts` - New utility for WalletConnect initialization
- `src/app/providers.tsx` - Added WalletConnect setup
- `src/app/globals.css` - Added WalletConnect modal styling
- `src/app/wagmi.ts` - Cleaned up configuration

### Key Features
- **Automatic Initialization**: WalletConnect configures itself on app load
- **Mobile Detection**: Automatically applies mobile-specific fixes
- **Deep Linking**: Proper handling of wallet deep links
- **Z-index Management**: Prevents modal layering issues
- **Theme Consistency**: Matches your app's design

## Troubleshooting

### If Still Not Working
1. **Check WalletConnect Cloud**: Ensure project metadata is complete
2. **Clear Browser Data**: Clear cache, cookies, and local storage
3. **Test Different Wallets**: Try different mobile wallets
4. **Check Console**: Look for WalletConnect initialization logs
5. **Network Issues**: Ensure you're not behind a restrictive firewall

### Common Issues
- **Project ID Mismatch**: Ensure environment variable matches cloud project
- **Metadata Incomplete**: All required fields must be filled in cloud dashboard
- **Deep Linking**: Mobile wallets need proper deep link configuration
- **Z-index Conflicts**: CSS fixes should resolve modal layering

## Testing Checklist
- [ ] WalletConnect project metadata updated in cloud dashboard
- [ ] Environment variables properly set
- [ ] Mobile device tested with different browsers
- [ ] MetaMask mobile connection works
- [ ] Uniswap Wallet connection works
- [ ] No "Invalid app configuration" errors
- [ ] Proper deep linking to wallet apps
- [ ] Modal styling consistent with app theme

## Support
If issues persist after implementing these fixes:
1. Check WalletConnect Cloud dashboard configuration
2. Verify environment variables
3. Test on different mobile devices/browsers
4. Check browser console for errors
5. Ensure WalletConnect project is active and properly configured
