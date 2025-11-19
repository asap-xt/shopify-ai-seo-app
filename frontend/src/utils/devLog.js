// frontend/src/utils/devLog.js
// Dev-only logging utility - logs in development and staging mode

const isDev = import.meta.env.DEV;
const isStaging = import.meta.env.MODE === 'staging' || window.location.hostname.includes('staging');

export const devLog = (...args) => {
  // Log in development OR staging (for debugging)
  if (isDev || isStaging) {
    console.log('[DEV]', ...args);
  }
};

export const devWarn = (...args) => {
  // Warn in development OR staging (for debugging)
  if (isDev || isStaging) {
    console.warn('[DEV]', ...args);
  }
};

export const devError = (...args) => {
  // Errors should always be logged, even in production
  console.error(...args);
};

