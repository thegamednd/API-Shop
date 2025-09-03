#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function fixImportsInFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let fixedContent = content.replace(/from '\.\//g, "from './").replace(/\.js';/g, ".mjs';");
    // Also fix dynamic imports - replace .js with .mjs in import() calls
    fixedContent = fixedContent.replace(/\.js'\)/g, ".mjs')");
    fs.writeFileSync(filePath, fixedContent);
    // Only log if there's an issue
  } catch (error) {
    console.error(`Error fixing imports in ${filePath}:`, error.message);
    throw error;
  }
}

function processDirectory(dir) {
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      processDirectory(fullPath);
    } else if (fullPath.endsWith('.mjs')) {
      fixImportsInFile(fullPath);
    }
  }
}

// Start processing from dist directory
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  try {
    processDirectory(distDir);
    // Silent success - only output on errors
  } catch (error) {
    console.error('Error processing imports:', error.message);
    process.exit(1);
  }
} else {
  console.error('dist directory not found');
  process.exit(1);
}