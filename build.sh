#!/bin/bash

# Clean dist directory
rm -rf dist

# Compile TypeScript and rename .js to .mjs
npx tsc && find dist -name "*.js" -type f -exec sh -c 'mv "$1" "${1%.js}.mjs"' _ {} \; && node fix-imports.js

# Create production-only package.json for dist
cat > dist/package.json << 'EOF'
{
  "name": "api-shop",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.879.0",
    "@aws-sdk/lib-dynamodb": "^3.879.0",
    "@aws-sdk/client-s3": "^3.922.0",
    "busboy": "^1.6.0",
    "sharp": "^0.34.4"
  }
}
EOF

# Install production dependencies with platform-specific binaries for Lambda
cd dist && npm install --production --silent --no-package-lock --platform=linux --arch=x64 && cd ..

# Clean up unnecessary files
cd dist && find node_modules -name "*.md" -delete 2>/dev/null || true && find node_modules -name "*.txt" -delete 2>/dev/null || true && cd ..

echo "Build completed. Deployment package ready in dist/"