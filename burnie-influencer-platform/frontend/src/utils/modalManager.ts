/**
 * Centralized Modal Management System
 * 
 * This is the single source of truth for all AppKit modal management.
 * It prevents conflicts between different systems trying to control the same modal.
 */

import { appKit } from '../app/reown';

// Global state management
let isPurchaseFlowActive = false;
let isModalDisabled = false;
let originalOpen: typeof appKit.open | null = null;

/**
 * Set purchase flow state
 */
export function setPurchaseFlowActive(active: boolean) {
  isPurchaseFlowActive = active;
  console.log('🔄 Purchase flow state changed:', active);
  
  // Re-apply modal management when state changes
  if (active) {
    applyModalManagement();
  } else {
    restoreOriginalOpen();
  }
}

/**
 * Temporarily disable modals (for transaction execution)
 */
export function disableModalsTemporarily(): () => void {
  if (isModalDisabled) {
    console.log('🚫 Modals already disabled');
    return () => {};
  }

  console.log('🚫 Temporarily disabling all modals');
  isModalDisabled = true;
  applyModalManagement();
  
  return () => {
    console.log('✅ Restoring modal functionality');
    isModalDisabled = false;
    applyModalManagement();
  };
}

/**
 * Apply the centralized modal management logic
 */
function applyModalManagement() {
  // Store original if not already stored
  if (!originalOpen) {
    originalOpen = appKit.open.bind(appKit);
  }

  // Override appKit.open with centralized logic
  appKit.open = function(options?: any) {
    const view = options?.view || 'default';
    
    console.log('🔍 Modal requested:', { view, isPurchaseFlowActive, isModalDisabled });
    
    // If modals are temporarily disabled, block everything
    if (isModalDisabled) {
      console.log('🚫 Modal blocked (temporarily disabled):', view);
      return Promise.resolve();
    }
    
    // If purchase flow is active, only allow connection modals
    if (isPurchaseFlowActive) {
      if (isConnectionModal(view)) {
        console.log('✅ Purchase flow active - allowing connection modal:', view);
        return originalOpen!(options);
      } else {
        console.log('🚫 Purchase flow active - blocking wallet management modal:', view);
        return Promise.resolve();
      }
    }
    
    // Normal state - block only wallet management modals
    if (isWalletManagementModal(view)) {
      console.log('🚫 Blocking wallet management modal:', view);
      return Promise.resolve();
    }
    
    // Allow all other modals
    console.log('✅ Allowing modal:', view);
    return originalOpen!(options);
  };
}

/**
 * Restore original appKit.open method
 */
function restoreOriginalOpen() {
  if (originalOpen) {
    appKit.open = originalOpen;
    console.log('✅ Restored original AppKit.open method');
  }
}

/**
 * Check if a view is a connection modal
 */
function isConnectionModal(view: string): boolean {
  return view === 'Connect' || 
         view === 'ConnectWallet' || 
         view === 'default' || 
         view === '';
}

/**
 * Check if a view is a wallet management modal
 */
function isWalletManagementModal(view: string): boolean {
  return view === 'Account' || 
         view === 'OnRamp' || 
         view === 'Swap' ||
         view === 'WalletManagement' ||
         view === 'FundWallet' ||
         view === 'Send' ||
         view === 'Activity';
}

/**
 * Force restore all modal functionality (emergency cleanup)
 */
export function forceRestoreAllModals(): void {
  isPurchaseFlowActive = false;
  isModalDisabled = false;
  restoreOriginalOpen();
  console.log('🔄 Force restored all modal functionality');
}

/**
 * Get current modal state
 */
export function getModalState() {
  return {
    isPurchaseFlowActive,
    isModalDisabled,
    hasOriginalOpen: !!originalOpen
  };
}

export default {
  setPurchaseFlowActive,
  disableModalsTemporarily,
  forceRestoreAllModals,
  getModalState
};
