// frontend/src/utils/devLog.js
// Dev-only logging utility - logs only in development mode

const isDev = import.meta.env.DEV;

export const devLog = (...args) => {
  if (isDev) {
    console.log(...args);
  }
};

export const devWarn = (...args) => {
  if (isDev) {
    console.warn(...args);
  }
};

export const devError = (...args) => {
  // Errors should always be logged, even in production
  console.error(...args);
};

