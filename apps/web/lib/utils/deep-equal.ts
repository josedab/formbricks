/**
 * Native deep equality check to replace lodash.isEqual
 * This eliminates the need for lodash, reducing bundle size
 *
 * RFC-0002: Bundle Size Optimization
 */

/**
 * Deep equality check for two values
 * Replaces lodash.isEqual for common use cases
 * @param a - First value
 * @param b - Second value
 * @returns true if values are deeply equal
 */
export function isEqual(a: any, b: any): boolean {
  // Same reference or primitive equality
  if (a === b) return true;

  // Handle null/undefined
  if (a == null || b == null) return a === b;

  // Different types
  if (typeof a !== typeof b) return false;

  // Handle primitives
  if (typeof a !== "object") return a === b;

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => isEqual(item, b[index]));
  }

  // One is array, other is not
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  // Handle dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // Handle RegExp
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.toString() === b.toString();
  }

  // Handle objects
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  return keysA.every((key) => {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    return isEqual(a[key], b[key]);
  });
}
