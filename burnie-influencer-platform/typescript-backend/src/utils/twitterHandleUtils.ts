/**
 * Twitter Handle Utilities
 * Provides consistent sanitization and validation for Twitter handles
 */

/**
 * Sanitizes a Twitter handle by removing all @ symbols and trimming whitespace
 * @param handle - The raw Twitter handle input
 * @returns The sanitized handle without @ symbols
 */
export function sanitizeTwitterHandle(handle: string): string {
  if (!handle) return '';
  
  // Remove all @ symbols and trim whitespace
  return handle.replace(/@/g, '').trim();
}

/**
 * Validates a Twitter handle format
 * @param handle - The sanitized Twitter handle
 * @returns Object with validation result and error message
 */
export function validateTwitterHandle(handle: string): { isValid: boolean; error?: string } {
  if (!handle) {
    return { isValid: false, error: 'Twitter handle is required' };
  }

  if (handle.length < 1 || handle.length > 15) {
    return { isValid: false, error: 'Twitter handle must be between 1-15 characters' };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(handle)) {
    return { isValid: false, error: 'Twitter handle can only contain letters, numbers, and underscores' };
  }

  return { isValid: true };
}

/**
 * Sanitizes and validates a Twitter handle in one step
 * @param handle - The raw Twitter handle input
 * @returns Object with sanitized handle and validation result
 */
export function processTwitterHandle(handle: string): {
  sanitized: string;
  isValid: boolean;
  error?: string;
} {
  const sanitized = sanitizeTwitterHandle(handle);
  const validation = validateTwitterHandle(sanitized);
  
  return {
    sanitized,
    isValid: validation.isValid,
    error: validation.error
  };
}
