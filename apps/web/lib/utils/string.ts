/**
 * Native string utilities to replace lodash string functions
 * This eliminates the need for lodash, reducing bundle size
 *
 * RFC-0002: Bundle Size Optimization
 */

/**
 * Capitalize the first letter of a string
 * Replaces lodash.capitalize
 * @param str - The string to capitalize
 * @returns The capitalized string
 */
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
