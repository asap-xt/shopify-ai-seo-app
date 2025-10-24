/**
 * Centralized logging utility with configurable log levels
 * 
 * LOG_LEVEL environment variable:
 * - error: Only errors
 * - warn: Errors + warnings
 * - info: Errors + warnings + important info (DEFAULT)
 * - debug: Everything (verbose)
 */

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = LEVELS[LOG_LEVEL] || LEVELS.info;

/**
 * Logger that respects LOG_LEVEL
 */
class Logger {
  constructor(prefix = '') {
    this.prefix = prefix;
  }

  error(...args) {
    if (currentLevel >= LEVELS.error) {
      console.error(this.prefix ? `[${this.prefix}]` : '', ...args);
    }
  }

  warn(...args) {
    if (currentLevel >= LEVELS.warn) {
      console.warn(this.prefix ? `[${this.prefix}]` : '', ...args);
    }
  }

  info(...args) {
    if (currentLevel >= LEVELS.info) {
      console.log(this.prefix ? `[${this.prefix}]` : '', ...args);
    }
  }

  debug(...args) {
    if (currentLevel >= LEVELS.debug) {
      console.log(this.prefix ? `[${this.prefix}]` : '', ...args);
    }
  }

  // Alias for backward compatibility
  log(...args) {
    this.info(...args);
  }
}

// Create loggers for different modules
const logger = new Logger();
const graphqlLogger = new Logger('GRAPHQL');
const tokenLogger = new Logger('TOKEN');
const apiLogger = new Logger('API');
const dbLogger = new Logger('DB');
const shopLogger = new Logger('SHOP');

// Helper to check if debug is enabled
function isDebugEnabled() {
  return currentLevel >= LEVELS.debug;
}

export {
  Logger,
  logger,
  graphqlLogger,
  tokenLogger,
  apiLogger,
  dbLogger,
  shopLogger,
  isDebugEnabled,
  LOG_LEVEL
};

