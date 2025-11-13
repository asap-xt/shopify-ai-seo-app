// frontend/src/hooks/usePlanHierarchy.js
// Central plan hierarchy management - single source of truth

/**
 * Get plan hierarchy array
 * This should match backend/plans.js PLANS object keys
 * 
 * WHY HARDCODED:
 * - Plan hierarchy is app logic, not dynamic data
 * - Order matters for plan comparison (Professional > Starter)
 * - Must be consistent across all frontend components
 * - Backend validates against PLANS object
 * 
 * TODO (future optimization):
 * - Fetch from /api/billing/info on app init
 * - Store in React Context or global state
 * - Auto-update if backend plans change
 */
export const PLAN_HIERARCHY = [
  'Starter',
  'Professional',
  'Professional Plus',
  'Growth',
  'Growth Plus',
  'Growth Extra',
  'Enterprise'
];

/**
 * Get lowercase plan hierarchy (for case-insensitive comparison)
 */
export const PLAN_HIERARCHY_LOWERCASE = PLAN_HIERARCHY.map(p => p.toLowerCase());

/**
 * Get plan index in hierarchy (higher = better plan)
 * @param {string} planName - Plan name (case-insensitive)
 * @returns {number} - Index in hierarchy, or -1 if not found
 */
export function getPlanIndex(planName) {
  if (!planName) return -1;
  // Handle both formats: "growth extra" (space) and "growth_extra" (underscore)
  const normalized = planName.toLowerCase().replace(/_/g, ' ');
  return PLAN_HIERARCHY_LOWERCASE.indexOf(normalized);
}

/**
 * Check if plan A is equal to or higher than plan B
 * @param {string} planA - Plan to check
 * @param {string} planB - Plan to compare against
 * @returns {boolean}
 */
export function isPlanAtLeast(planA, planB) {
  const indexA = getPlanIndex(planA);
  const indexB = getPlanIndex(planB);
  return indexA >= indexB && indexA !== -1;
}

/**
 * Check if plan has included tokens (Growth Extra, Enterprise)
 * @param {string} planName
 * @returns {boolean}
 */
export function hasIncludedTokens(planName) {
  const normalized = planName?.toLowerCase();
  return normalized === 'growth extra' || normalized === 'enterprise';
}

/**
 * Check if plan requires token purchase for AI features (Plus plans)
 * @param {string} planName
 * @returns {boolean}
 */
export function isPayPerUsePlan(planName) {
  const normalized = planName?.toLowerCase();
  return normalized === 'professional plus' || normalized === 'growth plus';
}

/**
 * Normalize plan name for comparison
 * Handles various formats: "Growth Extra", "growth_extra", "growth extra"
 * @param {string} planName
 * @returns {string} - Normalized plan name
 */
export function normalizePlanName(planName) {
  if (!planName) return 'starter';
  
  // Convert to lowercase and replace underscores with spaces
  const normalized = planName.toLowerCase().replace(/_/g, ' ');
  
  // Find matching plan in hierarchy
  const index = PLAN_HIERARCHY_LOWERCASE.indexOf(normalized);
  if (index !== -1) {
    return PLAN_HIERARCHY[index]; // Return capitalized version
  }
  
  // Fallback
  return 'Starter';
}

