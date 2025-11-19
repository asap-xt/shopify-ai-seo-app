// backend/utils/env.js
// Environment detection and configuration helpers

/**
 * Get current environment
 * @returns {string} 'production' | 'staging' | 'development'
 */
export function getEnvironment() {
  return process.env.NODE_ENV || 'development';
}

/**
 * Check if running in production
 */
export const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Check if running in staging
 */
export const IS_STAGING = process.env.NODE_ENV === 'staging';

/**
 * Check if running in development
 */
export const IS_DEV = !IS_PROD && !IS_STAGING;

/**
 * Get environment-specific app URL
 */
export function getAppUrl() {
  // Always use APP_URL from environment - no hardcoded fallbacks
  if (!process.env.APP_URL) {
    throw new Error('APP_URL environment variable is required');
  }
  return process.env.APP_URL;
}

/**
 * Get environment name for logging
 */
export function getEnvName() {
  if (IS_PROD) return 'PRODUCTION';
  if (IS_STAGING) return 'STAGING';
  return 'DEVELOPMENT';
}

/**
 * Check if feature should be enabled based on environment
 * @param {string} feature - Feature name
 * @param {object} config - Feature configuration
 */
export function isFeatureEnabled(feature, config = {}) {
  const { 
    production = true, 
    staging = true, 
    development = true 
  } = config;
  
  if (IS_PROD) return production;
  if (IS_STAGING) return staging;
  return development;
}

/**
 * Get environment-specific configuration
 */
export function getEnvConfig() {
  return {
    env: getEnvironment(),
    isProd: IS_PROD,
    isStaging: IS_STAGING,
    isDev: IS_DEV,
    appUrl: getAppUrl(),
    envName: getEnvName()
  };
}

