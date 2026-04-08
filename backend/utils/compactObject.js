/**
 * Recursively strip null, undefined, empty string, empty array, and empty object values.
 * Returns a shallow copy — never mutates input.
 */
export function compactObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object' || obj instanceof Date) return obj;
  if (Array.isArray(obj)) {
    const filtered = obj.filter(v => v !== null && v !== undefined && v !== '');
    return filtered.length > 0 ? filtered : undefined;
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      const filtered = value.filter(v => v !== null && v !== undefined && v !== '');
      if (filtered.length > 0) result[key] = filtered;
    } else if (typeof value === 'object' && !(value instanceof Date)) {
      const nested = compactObject(value);
      if (nested !== undefined && Object.keys(nested).length > 0) result[key] = nested;
    } else {
      result[key] = value;
    }
  }
  return result;
}
