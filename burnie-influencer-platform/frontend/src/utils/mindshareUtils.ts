/**
 * Generate a random predicted mindshare between 85.0 and 100.0
 * Returns a number with one decimal place
 */
export function generateRandomMindshare(): number {
  const min = 85.0;
  const max = 100.0;
  const random = Math.random() * (max - min) + min;
  return Math.round(random * 10) / 10; // Round to 1 decimal place
}

/**
 * Format mindshare value for display
 */
export function formatMindshare(value: number): string {
  return `${value.toFixed(1)}%`;
}
