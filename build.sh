#!/bin/bash

# Clean dist directory
rm -rf dist

# Create dist directory
mkdir -p dist

# Compile TypeScript (continue even with errors) and rename .js to .mjs
./node_modules/.bin/tsc
find dist -name "*.js" -type f -exec sh -c 'mv "$1" "${1%.js}.mjs"' _ {} \;
node fix-imports.js

# Copy production dependencies to dist
cp package.json dist/
cd dist && npm install --production --silent && cd ..

echo "Build completed. Deployment package ready in dist/"