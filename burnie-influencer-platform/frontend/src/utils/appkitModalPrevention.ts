/**
 * AppKit Modal Prevention Utility
 * Lightweight prevention for any remaining wallet management modals
 * Most prevention is now handled at the AppKit configuration level
 */

export function preventAppKitModals() {
  // Conservative prevention - only target very specific fund management modals
  const preventAppKitModals = () => {
    // Target only very specific fund management modal elements
    const unwantedModals = document.querySelectorAll(`
      [data-testid*="wallet-management"][data-testid*="modal"], 
      [data-testid*="onramp"][data-testid*="modal"], 
      [data-testid*="swap"][data-testid*="modal"],
      [data-testid*="fund-wallet"][data-testid*="modal"],
      [data-testid*="send"][data-testid*="modal"],
      [data-testid*="activity"][data-testid*="modal"]
    `);
    
    unwantedModals.forEach(modal => {
      const el = modal as HTMLElement;
      const testId = el.getAttribute('data-testid');
      
      // Only remove if it's clearly a fund management modal
      if ((testId?.includes('wallet-management') && testId.includes('modal')) ||
          (testId?.includes('onramp') && testId.includes('modal')) ||
          (testId?.includes('swap') && testId.includes('modal')) ||
          (testId?.includes('fund-wallet') && testId.includes('modal')) ||
          (testId?.includes('send') && testId.includes('modal')) ||
          (testId?.includes('activity') && testId.includes('modal'))) {
        console.log('Removing fund management modal:', el);
        el.remove();
      }
    });
  };

  // Conservative DOM mutation interception - only block very specific fund management modals
  const originalAppendChild = Node.prototype.appendChild;
  const originalInsertBefore = Node.prototype.insertBefore;
  
  (Node.prototype as any).appendChild = function(child: any) {
    // Only block very specific fund management modals, not all AppKit elements
    if (child && typeof child === 'object' && 'tagName' in child) {
      const element = child as Element;
      const testId = element.getAttribute('data-testid');
      const tagName = element.tagName?.toLowerCase();
      
      // Only block if it's clearly a fund management modal
      if ((testId?.includes('wallet-management') && testId.includes('modal')) ||
          (testId?.includes('onramp') && testId.includes('modal')) ||
          (testId?.includes('swap') && testId.includes('modal')) ||
          (testId?.includes('fund-wallet') && testId.includes('modal')) ||
          (testId?.includes('send') && testId.includes('modal')) ||
          (testId?.includes('activity') && testId.includes('modal'))) {
        console.log('Blocked fund management modal from DOM:', element);
        return child; // Don't add to DOM
      }
    }
    return originalAppendChild.call(this, child);
  };
  
  (Node.prototype as any).insertBefore = function(child: any, reference: any) {
    // Only block very specific fund management modals, not all AppKit elements
    if (child && typeof child === 'object' && 'tagName' in child) {
      const element = child as Element;
      const testId = element.getAttribute('data-testid');
      const tagName = element.tagName?.toLowerCase();
      
      // Only block if it's clearly a fund management modal
      if ((testId?.includes('wallet-management') && testId.includes('modal')) ||
          (testId?.includes('onramp') && testId.includes('modal')) ||
          (testId?.includes('swap') && testId.includes('modal')) ||
          (testId?.includes('fund-wallet') && testId.includes('modal')) ||
          (testId?.includes('send') && testId.includes('modal')) ||
          (testId?.includes('activity') && testId.includes('modal'))) {
        console.log('Blocked fund management modal from DOM:', element);
        return child; // Don't add to DOM
      }
    }
    return originalInsertBefore.call(this, child, reference);
  };

  // Run immediately
  preventAppKitModals();

  // Conservative mutation observer - only for very specific fund management modals
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            const testId = element.getAttribute('data-testid');
            
            // Only trigger for very specific fund management modals
            if ((testId?.includes('wallet-management') && testId.includes('modal')) ||
                (testId?.includes('onramp') && testId.includes('modal')) ||
                (testId?.includes('swap') && testId.includes('modal')) ||
                (testId?.includes('fund-wallet') && testId.includes('modal')) ||
                (testId?.includes('send') && testId.includes('modal')) ||
                (testId?.includes('activity') && testId.includes('modal'))) {
              console.log('Mutation observer detected fund management modal:', element);
              preventAppKitModals();
            }
          }
        });
      }
    });
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Also run periodically to catch any missed modals (less frequent to avoid performance issues)
  const interval = setInterval(preventAppKitModals, 2000);

  // Return cleanup function
  return () => {
    observer.disconnect();
    clearInterval(interval);
    
    // Restore original DOM methods
    Node.prototype.appendChild = originalAppendChild;
    Node.prototype.insertBefore = originalInsertBefore;
  };
}

/**
 * Temporary modal prevention for post-transaction scenarios
 * This function provides targeted prevention for fund management modals only
 */
export function preventModalsTemporarily(duration: number = 2000) {
  console.log(`🚫 Temporarily preventing fund management modals for ${duration}ms`);
  
  const preventFundModals = () => {
    // Only target specific fund management modals, not all AppKit modals
    const fundModals = document.querySelectorAll(`
      [data-testid*="wallet-management"], 
      [data-testid*="onramp"], 
      [data-testid*="swap"],
      [data-testid*="account"],
      [data-testid*="fund-wallet"],
      [data-testid*="send"],
      [data-testid*="activity"],
      w3m-account-view,
      w3m-onramp-view,
      w3m-swap-view
    `);
    
    fundModals.forEach(modal => {
      const el = modal as HTMLElement;
      // Only remove if it's actually a fund management modal
      if (el.getAttribute('data-testid')?.includes('wallet-management') ||
          el.getAttribute('data-testid')?.includes('onramp') ||
          el.getAttribute('data-testid')?.includes('swap') ||
          el.getAttribute('data-testid')?.includes('account') ||
          el.getAttribute('data-testid')?.includes('fund-wallet') ||
          el.getAttribute('data-testid')?.includes('send') ||
          el.getAttribute('data-testid')?.includes('activity') ||
          el.tagName?.toLowerCase().includes('w3m-account') ||
          el.tagName?.toLowerCase().includes('w3m-onramp') ||
          el.tagName?.toLowerCase().includes('w3m-swap')) {
        console.log('Temporarily removing fund management modal:', el);
        el.remove();
      }
    });
  };

  // Run immediately
  preventFundModals();

  // Set up targeted prevention (less frequent to avoid scroll interference)
  const interval = setInterval(preventFundModals, 500);

  // Stop after duration
  setTimeout(() => {
    clearInterval(interval);
    console.log('✅ Temporary fund modal prevention ended');
  }, duration);
}

// Make emergency functions available globally for debugging
if (typeof window !== 'undefined') {
  (window as any).goHome = () => {
    console.log('🔄 Force redirecting to homepage');
    window.location.replace('/');
  };
  
  (window as any).preventModalsTemporarily = preventModalsTemporarily;
}