#!/usr/bin/env node
/**
 * Script to reduce verbose logging in production
 * 
 * This script adds LOG_LEVEL support to reduce Railway log spam
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Files to update with reduced logging
const filesToUpdate = [
  'backend/middleware/apiResolver.js',
  'backend/middleware/attachShop.js',
  'backend/utils/shopifyApi.js'
];

console.log('🧹 Reducing verbose logging...\n');

filesToUpdate.forEach(file => {
  const filePath = path.join(__dirname, '..', '..', file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  Skipping ${file} (not found)`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  
  // Check if file already has logger import
  if (!content.includes('from \'./logger.js\'') && !content.includes('from \'../utils/logger.js\'')) {
    // Add logger import after first import
    const firstImportMatch = content.match(/^import .+ from .+;$/m);
    if (firstImportMatch) {
      const importStatement = file.includes('utils/') 
        ? '\nimport { logger } from \'./logger.js\';'
        : '\nimport { logger } from \'../utils/logger.js\';';
      
      content = content.replace(
        firstImportMatch[0],
        firstImportMatch[0] + importStatement
      );
      modified = true;
    }
  }
  
  // Replace console.log with logger.debug for verbose logs
  const verbosePatterns = [
    /console\.log\(\s*\[API-RESOLVER\]/g,
    /console\.log\(\s*\[ATTACH_SHOP\]/g,
    /console\.log\(\s*\[GRAPHQL\]\s+Shop:/g,
    /console\.log\(\s*\[GRAPHQL\]\s+Query:/g,
    /console\.log\(\s*\[GRAPHQL\]\s+Variables:/g,
    /console\.log\(\s*\[GRAPHQL\]\s+Token resolved:/g,
    /console\.log\(\s*\[GRAPHQL\]\s+URL:/g,
    /console\.log\(\s*\[GRAPHQL\]\s+Success/g
  ];
  
  verbosePatterns.forEach(pattern => {
    if (pattern.test(content)) {
      content = content.replace(pattern, 'logger.debug(');
      modified = true;
    }
  });
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Updated ${file}`);
  } else {
    console.log(`⏭️  ${file} (no changes needed)`);
  }
});

console.log('\n✅ Logging reduction complete!');
console.log('\n📋 To enable verbose logs, set: LOG_LEVEL=debug');
console.log('📋 Default level is "info" (errors + warnings + important info only)');

